# SOURCE: template v1.3.2 (7eecc51) sha256=cb44cf958c5971190460f8e1c5d2a0e5a0080f9071ec9da06f1883d264bc4861 — 勿手改;升版用 sync-gates.sh
# SOURCE: nightmare-assault (project C) tests/test_mutate.py @ 4f1948ac, adopted into template 1.3.1 with user approval 2026-09-05
"""STORY-70-13 —— 校準量尺：給 dev/tools/mutate.py 一組 poison 驅動的測試。

`mutate.py` 是本專案「突變證明」的唯一自動化機制，但它自己從未被測試過。
本檔案的每個測試都是一個「必須被 mutate.py 拒絕（或如實回報）的輸入」，
逐條對應它 docstring 宣稱的 exit code 0/1/2/3/4。

除了 exit 3（見 test_ac1_exit_3_...
的說明：git blob 是 content-addressed，正常使用下不可能重現 hash 不一致，
只能用 monkeypatch 模擬 git object 損毀），其餘每個測試都透過
`subprocess` 直接呼叫 `dev/tools/mutate.py`（docstring 裡示範的用法），
cwd 指向一個一次性的暫存 git repo——不觸碰本專案的 git 歷史。
"""
from __future__ import annotations

import hashlib
import importlib.util
import re
import signal
import subprocess
import sys
import time
from pathlib import Path
from unittest import mock

# 模板版本(scripts/py/):mutate.py 跟本檔同目錄,不是專案 C 的 repo 佈局
# (dev/tools/)——本檔要能在 `template/scripts/py/` 底下用
# `pytest test_mutate.py -q` 獨立跑,不依賴專案 C 的目錄結構或任何 conftest。
MUTATE_PY = Path(__file__).resolve().parent / "mutate.py"

TARGET_SRC = """def add(a, b):
    return a + b
"""

TEST_SRC = """from target import add


def test_add():
    assert add(2, 3) == 5
"""

FAILING_TEST_SRC = """from target import add


def test_add():
    assert add(2, 3) == 999
"""

# STORY-70-14：同一個字面字串出現兩次（第 2 行、第 6 行），用來驗證
# occurrences != 1 時 mutate.py 必須拒絕，以及 --nth 只動指定那一處。
TARGET_SRC_MULTI = """def add(a, b):
    return a + b


def add2(a, b):
    return a + b
"""

TEST_SRC_BOTH = """from target import add, add2


def test_add():
    assert add(2, 3) == 5


def test_add2():
    assert add2(2, 3) == 5
"""


def _run_git(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    assert r.returncode == 0, f"git {args} failed: {r.stderr}"
    return r


def make_scratch_repo(base: Path, name: str = "scratch") -> Path:
    repo = base / name
    repo.mkdir(parents=True)
    _run_git(repo, "init", "-q")
    _run_git(repo, "config", "user.email", "mutate-test@example.com")
    _run_git(repo, "config", "user.name", "mutate-test")
    _run_git(repo, "config", "commit.gpgsign", "false")
    return repo


def write_and_commit(repo: Path, files: dict[str, str], message: str) -> None:
    for rel, content in files.items():
        p = repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        _run_git(repo, "add", "--", rel)
    _run_git(repo, "commit", "-q", "-m", message)


def run_mutate_cli(
    cwd: Path,
    *,
    file: str,
    replace: str,
    with_: str,
    expect_fail: str,
    mutate_py: Path = MUTATE_PY,
    nth: int | None = None,
) -> subprocess.CompletedProcess:
    argv = [
        sys.executable, str(mutate_py),
        "--file", file,
        "--replace", replace,
        "--with", with_,
        "--expect-fail", expect_fail,
    ]
    if nth is not None:
        argv += ["--nth", str(nth)]
    return subprocess.run(argv, cwd=cwd, capture_output=True, text=True)


def _find_unique_stripped_line(text: str, literal: str) -> tuple[int, str]:
    lines = text.splitlines()
    matches = [(i, ln) for i, ln in enumerate(lines, start=1) if ln.strip() == literal]
    assert len(matches) == 1, (
        f"expected exactly one line stripped-equal to {literal!r}, "
        f"found {len(matches)}: {matches}"
    )
    return matches[0]


def _load_mutate_module(name: str):
    spec = importlib.util.spec_from_file_location(name, MUTATE_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# AC: exit code 0/1/2/3/4 每一條都有至少一個測試實際產生該碼
# ---------------------------------------------------------------------------

def test_ac1_exit_0_successful_poison_is_caught_and_restored(tmp_path):
    repo = make_scratch_repo(tmp_path)
    write_and_commit(repo, {"target.py": TARGET_SRC, "test_target.py": TEST_SRC}, "init")

    result = run_mutate_cli(
        repo, file="target.py", replace="return a + b", with_="return a - b",
        expect_fail="test_target.py::test_add",
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert (repo / "target.py").read_text(encoding="utf-8") == TARGET_SRC


def test_ac1_and_ac4_exit_1_when_target_already_red_before_mutation(tmp_path):
    """AC（poison）：目標 node id 在突變之前就是紅的 -> 必須回 exit 1，
    且不得拿「本來就紅」當成突變造成的紅（檔案完全不應被寫入過）。"""
    repo = make_scratch_repo(tmp_path)
    write_and_commit(repo, {"target.py": TARGET_SRC, "test_target.py": FAILING_TEST_SRC}, "init")

    result = run_mutate_cli(
        repo, file="target.py", replace="return a + b", with_="return a - b",
        expect_fail="test_target.py::test_add",
    )

    assert result.returncode == 1, result.stdout + result.stderr
    assert (repo / "target.py").read_text(encoding="utf-8") == TARGET_SRC


def test_ac1_and_ac2_exit_2_when_mutation_does_not_turn_target_red(tmp_path):
    """AC（poison，本工單核心）：一個不會讓目標測試變紅的突變 ->
    mutate.py 必須回 exit 2。若回 0，即為 121 張證明賴以成立的偽陽性。"""
    repo = make_scratch_repo(tmp_path)
    write_and_commit(repo, {"target.py": TARGET_SRC, "test_target.py": TEST_SRC}, "init")

    result = run_mutate_cli(
        repo, file="target.py",
        replace="def add(a, b):", with_="def add(a, b):  # harmless, behavior unchanged",
        expect_fail="test_target.py::test_add",
    )

    assert result.returncode == 2, result.stdout + result.stderr
    assert (repo / "target.py").read_text(encoding="utf-8") == TARGET_SRC


def test_ac1_and_ac3_exit_4_when_mutation_causes_non_assertion_nonzero_exit(tmp_path):
    """AC（poison）：突變造成非 1 的非零 exit（實測：拿掉 `def` 的冒號讓
    pytest 在收集階段炸掉，這台機器上的 pytest 9.0.3 對這個情境回 4
    ——`found no collectors for ... test_add`）-> mutate.py 必須回 exit 4，
    不得當成突變生效。"""
    repo = make_scratch_repo(tmp_path)
    write_and_commit(repo, {"target.py": TARGET_SRC, "test_target.py": TEST_SRC}, "init")

    result = run_mutate_cli(
        repo, file="target.py",
        replace="def add(a, b):", with_="def add(a, b)",
        expect_fail="test_target.py::test_add",
    )

    assert result.returncode == 4, result.stdout + result.stderr
    assert (repo / "target.py").read_text(encoding="utf-8") == TARGET_SRC


def test_ac1_exit_3_restore_hash_mismatch_is_detected_and_reported(tmp_path):
    """AC（exit 3 覆蓋）：git blob 是 content-addressed，`git show <sha>`
    在正常使用下永遠回傳寫入時的原始 bytes，因此「還原後 hash 不一致」
    在真實 git 操作下不可重現（這正是它自己的 docstring 寫「理論上不應
    發生」的原因）。唯一能讓這條防線亮起來的成因是 git object 本身損毀
    ——這裡用 monkeypatch 模擬損毀（只換掉還原步驟讀到的 bytes，套用前
    的內部一致性檢查仍走真正的 git show），藉此證明比對邏輯真的會抓到
    不一致並回 3，而不是只讀程式碼推論。"""
    repo = make_scratch_repo(tmp_path)
    write_and_commit(repo, {"target.py": TARGET_SRC, "test_target.py": TEST_SRC}, "init")

    mutate_mod = _load_mutate_module("mutate_under_test_exit3")
    real_read_blob_bytes = mutate_mod._read_blob_bytes
    calls = {"n": 0}

    def fake_read_blob_bytes(root, sha):
        calls["n"] += 1
        if calls["n"] == 1:
            return real_read_blob_bytes(root, sha)
        return b"CORRUPTED-BY-TEST-SIMULATING-GIT-OBJECT-DAMAGE"

    with mock.patch.object(mutate_mod, "_read_blob_bytes", side_effect=fake_read_blob_bytes):
        rc = mutate_mod.run_mutation(
            root=repo, file="target.py",
            replace="return a + b", with_="return a - b",
            expect_fail="test_target.py::test_add",
        )

    assert rc == 3
    assert calls["n"] == 2
    final_bytes = (repo / "target.py").read_bytes()
    assert final_bytes == b"CORRUPTED-BY-TEST-SIMULATING-GIT-OBJECT-DAMAGE"


# ---------------------------------------------------------------------------
# AC: --replace 出現多次時拒絕，--nth 指定唯一一處（STORY-70-14）
# ---------------------------------------------------------------------------

def test_ac_nth_rejects_non_unique_replace_without_nth(tmp_path):
    """AC「多處拒絕」：--replace 字串出現 2 次且未給 --nth -> 必須 exit 1、
    訊息裡印出兩處各自的行號（2、6），且檔案完全未被修改。"""
    repo = make_scratch_repo(tmp_path)
    write_and_commit(repo, {"target.py": TARGET_SRC_MULTI, "test_target.py": TEST_SRC}, "init")

    result = run_mutate_cli(
        repo, file="target.py", replace="return a + b", with_="return a - b",
        expect_fail="test_target.py::test_add",
    )

    combined = result.stdout + result.stderr
    assert result.returncode == 1, combined
    assert "[2, 6]" in combined, combined
    assert "--nth" in combined, combined
    assert (repo / "target.py").read_text(encoding="utf-8") == TARGET_SRC_MULTI

    status = _run_git(repo, "status", "--porcelain")
    assert status.stdout.strip() == "", status.stdout


def test_ac_nth_mutates_only_the_specified_occurrence(tmp_path):
    """AC「--nth N 只動一處」：同一個多處案例加 --nth 2，只有第 6 行（第 2 次
    出現）被改，第 2 行（第 1 次出現）維持原樣。mutate.py 設計上跑完一定會
    自動把檔案還原，事後 `git diff`/檔案內容必然乾淨——要看「套用當下」的
    狀態，得攔在還原之前：monkeypatch `_run_pytest`，在它被第二次呼叫
    （突變後那次）時，讀一次當下的檔案內容再繼續走真正的邏輯。"""
    repo = make_scratch_repo(tmp_path)
    write_and_commit(repo, {"target.py": TARGET_SRC_MULTI, "test_target.py": TEST_SRC_BOTH}, "init")

    mutate_mod = _load_mutate_module("mutate_under_test_nth")
    real_run_pytest = mutate_mod._run_pytest
    calls = {"n": 0}
    captured: dict[str, str] = {}

    def fake_run_pytest(root, node_id):
        calls["n"] += 1
        if calls["n"] == 2:
            captured["mutated_text"] = (root / "target.py").read_text(encoding="utf-8")
        return real_run_pytest(root, node_id)

    with mock.patch.object(mutate_mod, "_run_pytest", side_effect=fake_run_pytest):
        rc = mutate_mod.run_mutation(
            root=repo, file="target.py",
            replace="return a + b", with_="return a - b",
            expect_fail="test_target.py::test_add2",
            nth=2,
        )

    # expect_fail 是 test_add2（只測 add2()）；nth=2 突變的正是 add2() 裡
    # 那一處 -> 應該真的變紅（rc=0）。若 --nth 沒生效、兩處都被改，第 1 處
    # 的 add() 也會被改壞，但 test_add2 本身依然會紅——所以 rc=0 本身還不
    # 夠證明「只動一處」，真正的證據是下面對 mutated_text 逐行的比對。
    assert rc == 0, "nth=2 應該讓 test_add2 變紅\n" + str(captured)
    assert calls["n"] == 2

    original_lines = TARGET_SRC_MULTI.splitlines()
    mutated_lines = captured["mutated_text"].splitlines()
    assert mutated_lines[1] == original_lines[1], "第 1 處（第 2 行）不應被動到"
    assert mutated_lines[5] == "    return a - b", "第 2 處（第 6 行）應該被改"
    diffs = [i for i in range(len(original_lines)) if mutated_lines[i] != original_lines[i]]
    assert diffs == [5], f"應該只有第 6 行（index 5）變動，實際變動的行 index：{diffs}"

    assert (repo / "target.py").read_text(encoding="utf-8") == TARGET_SRC_MULTI, (
        "跑完之後應已還原成原始內容"
    )


def test_ac_replace_not_found_still_exits_1_and_leaves_file_untouched(tmp_path):
    """AC「找不到仍 exit 1」：既有行為（occurrences == 0）不得被本次改動削弱
    ——回歸測試，本工單之前沒有任何測試直接涵蓋這一條。"""
    repo = make_scratch_repo(tmp_path)
    write_and_commit(repo, {"target.py": TARGET_SRC, "test_target.py": TEST_SRC}, "init")

    result = run_mutate_cli(
        repo, file="target.py", replace="this string does not exist anywhere",
        with_="whatever", expect_fail="test_target.py::test_add",
    )

    assert result.returncode == 1, result.stdout + result.stderr
    assert (repo / "target.py").read_text(encoding="utf-8") == TARGET_SRC


# ---------------------------------------------------------------------------
# AC: 還原完整性（STORY-60-27 / STORY-62-02 事故形狀）
# ---------------------------------------------------------------------------

def test_ac_restore_preserves_other_uncommitted_edits_and_matches_sha256(tmp_path):
    """突變前，檔案已有其他「合法、還沒 commit」的編輯（模擬開發中被
    STORY-60-27/62-02 wipe 掉的那種狀態）。mutate.py 會先把它 WIP commit
    封存，套用突變、測試、還原到「封存後」的內容——而不是還原到更早、
    不含這次合法編輯的版本。用 sha256 逐位元比對整個檔案，一次證明
    兩件事：突變被撤銷了、合法編輯沒被清掉。"""
    repo = make_scratch_repo(tmp_path)
    write_and_commit(repo, {"target.py": TARGET_SRC, "test_target.py": TEST_SRC}, "init")

    edited = TARGET_SRC + "\n\ndef sub(a, b):\n    return a - b\n"
    (repo / "target.py").write_text(edited, encoding="utf-8")
    pre_mutation_bytes = edited.encode("utf-8")
    pre_mutation_sha256 = hashlib.sha256(pre_mutation_bytes).hexdigest()

    result = run_mutate_cli(
        repo, file="target.py", replace="return a + b", with_="return a - b",
        expect_fail="test_target.py::test_add",
    )
    assert result.returncode == 0, result.stdout + result.stderr

    final_bytes = (repo / "target.py").read_bytes()
    assert hashlib.sha256(final_bytes).hexdigest() == pre_mutation_sha256
    assert final_bytes == pre_mutation_bytes


# ---------------------------------------------------------------------------
# AC: 禁用指令
# ---------------------------------------------------------------------------

def test_ac_destructive_git_commands_never_appear_in_mutate_py():
    result = subprocess.run(
        ["grep", "-nE", r"(reset --hard|clean -fd|checkout -- \.|push --force)", str(MUTATE_PY)],
        capture_output=True, text=True,
    )
    assert result.returncode == 1, f"found banned destructive command literal(s):\n{result.stdout}"
    assert result.stdout == ""


# ---------------------------------------------------------------------------
# AC: 證明有牙（用 mutate.py 證明 mutate.py）+ 上一條自己不得是空的
# ---------------------------------------------------------------------------

INNER_POISON_TEST_SRC = '''"""自成一體的 poison test，複製進 meta scratch repo；不 import 本檔案，
避免跨檔相依把 sys.path 弄亂。邏輯與 test_ac1_and_ac2_exit_2_... 相同：
一個不會讓目標測試變紅的突變 -> 期待 mutate.py 回 exit 2。"""
import subprocess
import sys
from pathlib import Path

MUTATE_PY_UNDER_TEST = Path(__file__).resolve().parents[1] / "dev" / "tools" / "mutate.py"

TARGET_SRC = """def add(a, b):
    return a + b
"""

TEST_SRC = """from target import add


def test_add():
    assert add(2, 3) == 5
"""


def _run_git(cwd, *args):
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r


def _make_nested_repo(base):
    repo = base / "nested"
    repo.mkdir()
    _run_git(repo, "init", "-q")
    _run_git(repo, "config", "user.email", "inner@example.com")
    _run_git(repo, "config", "user.name", "inner")
    _run_git(repo, "config", "commit.gpgsign", "false")
    (repo / "target.py").write_text(TARGET_SRC, encoding="utf-8")
    (repo / "test_target.py").write_text(TEST_SRC, encoding="utf-8")
    _run_git(repo, "add", "-A")
    _run_git(repo, "commit", "-q", "-m", "init")
    return repo


def test_inner_poison_harmless_mutation_must_return_exit_2(tmp_path):
    repo = _make_nested_repo(tmp_path)
    result = subprocess.run(
        [sys.executable, str(MUTATE_PY_UNDER_TEST),
         "--file", "target.py",
         "--replace", "def add(a, b):",
         "--with", "def add(a, b):  # harmless, behavior unchanged",
         "--expect-fail", "test_target.py::test_add"],
        cwd=repo, capture_output=True, text=True,
    )
    assert result.returncode == 2, result.stdout + result.stderr
'''


def test_ac7_meta_guard_flips_red_when_exit2_detection_disabled(tmp_path):
    """把 dev/tools/mutate.py 的 exit-2 判定行（`return 2`）植入突變改成
    `return 0`，對應的 poison test（上面 test_inner_poison_...，邏輯同
    test_ac1_and_ac2_exit_2_...）必須變紅。

    做法：把 dev/tools/mutate.py 複製進一次性 meta scratch repo，連同一份
    自成一體的 poison test，用「本檔案讀取、未被動過」的真正
    dev/tools/mutate.py 當驅動工具，對 scratch repo 裡的副本執行突變
    ——meta-guard 因此是真的呼叫（複製過去的）guard 程式碼跑一次
    綠、跑一次紅，不是重述斷言。"""
    meta_repo = make_scratch_repo(tmp_path, name="meta")
    mutate_py_text = MUTATE_PY.read_text(encoding="utf-8")
    write_and_commit(
        meta_repo,
        {
            "dev/tools/mutate.py": mutate_py_text,
            "tests/test_inner_poison.py": INNER_POISON_TEST_SRC,
        },
        "init meta scratch repo (copy of dev/tools/mutate.py)",
    )

    result = run_mutate_cli(
        meta_repo,
        file="dev/tools/mutate.py",
        replace="return 2",
        with_="return 0",
        expect_fail=(
            "tests/test_inner_poison.py::"
            "test_inner_poison_harmless_mutation_must_return_exit_2"
        ),
        mutate_py=MUTATE_PY,
    )

    assert result.returncode == 0, (
        "meta-guard 沒有牙：把 dev/tools/mutate.py 的 exit-2 判定改成回 0 "
        "之後，對應的 poison test 竟然沒有變紅。\n" + result.stdout + result.stderr
    )
    assert (meta_repo / "dev" / "tools" / "mutate.py").read_text(encoding="utf-8") == mutate_py_text


def test_ac8_exit2_mutation_line_is_actually_executed(tmp_path):
    """上一條自己不得是空的：確認 test_ac7 突變所在的那一行
    （`return 2`）在 harmless-mutation 這個測試情境下真的被執行到，不是
    植在永遠不會被走到的死路上。用 stdlib `python -m trace --count`
    逐行計數，讀 .cover 檔案裡那一行的執行次數（可觀察副作用，不推論）。

    注意（已當場驗證）：`python -m trace` 包裝下的行程 exit code 不可信賴
    地反映被包裝程式的 sys.exit() 回傳值——同一個 harmless-mutation 情境，
    不套 trace 直接跑回 2（見 test_ac1_and_ac2_exit_2_...），套了 trace
    卻回 0。因此本測試只讀 .cover 的逐行計數；exit code 的正確性已由
    上面的測試分別驗證。"""
    mutate_py_text = MUTATE_PY.read_text(encoding="utf-8")
    line_no, line_text = _find_unique_stripped_line(mutate_py_text, "return 2")
    assert line_text.strip() == "return 2"

    repo = make_scratch_repo(tmp_path)
    write_and_commit(repo, {"target.py": TARGET_SRC, "test_target.py": TEST_SRC}, "init")

    cover_dir = tmp_path / "cover"
    cover_dir.mkdir()
    subprocess.run(
        [
            sys.executable, "-m", "trace", "--count", f"--coverdir={cover_dir}",
            str(MUTATE_PY),
            "--file", "target.py",
            "--replace", "def add(a, b):",
            "--with", "def add(a, b):  # harmless, behavior unchanged",
            "--expect-fail", "test_target.py::test_add",
        ],
        cwd=repo, capture_output=True, text=True,
    )

    cover_file = cover_dir / "mutate.cover"
    assert cover_file.is_file(), sorted(p.name for p in cover_dir.iterdir())
    cover_lines = cover_file.read_text(encoding="utf-8").splitlines()
    assert len(cover_lines) == len(mutate_py_text.splitlines()), (
        "trace 逐行輸出與原始檔案行數不一致，無法可靠對應行號"
    )
    hit_line = cover_lines[line_no - 1]
    m = re.match(r"^\s*(\d+):", hit_line)
    assert m is not None, (
        f"dev/tools/mutate.py:{line_no}（`return 2`）在這個測試情境下"
        f"沒有被執行到，是死路：{hit_line!r}"
    )
    assert int(m.group(1)) >= 1


# ---------------------------------------------------------------------------
# STORY-70-18：被中斷（SIGTERM/SIGKILL）之後 tip 必須乾淨
# ---------------------------------------------------------------------------

# 目標測試故意 sleep，讓 mutate.py 卡在「跑測試」這一步的時間拉長到肉眼
# 可控的範圍，好讓下面的測試能在真的送出訊號之前，可靠地等到 mutate.py
# 已經走到危險窗口（已寫 sentinel、正在跑突變後的 pytest），而不是用猜的
# sleep 時間賭時機。
SLOW_TEST_SRC = """import time

from target import add


def test_add():
    time.sleep(1.5)
    assert add(2, 3) == 5
"""


def _state_dir(repo: Path) -> Path:
    return repo / ".git" / "mutate-state"


def _wait_for_state_file(repo: Path, timeout: float = 15.0) -> Path:
    """輪詢等 mutate.py 寫出 sentinel 狀態檔——它在危險窗口一開始
    （套用突變、跑測試之前）就會出現，是比猜 sleep 時間可靠得多的同步點。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        files = list(_state_dir(repo).glob("*.json"))
        if files:
            return files[0]
        time.sleep(0.05)
    raise AssertionError(
        f"逾時（{timeout}s）沒有等到 sentinel 狀態檔出現在 {_state_dir(repo)}"
        f"——代表 mutate.py 根本沒跑到危險窗口，測試前提不成立。"
    )


def popen_mutate_cli(
    cwd: Path,
    *,
    file: str,
    replace: str,
    with_: str,
    expect_fail: str,
    mutate_py: Path = MUTATE_PY,
    nth: int | None = None,
) -> subprocess.Popen:
    argv = [
        sys.executable, str(mutate_py),
        "--file", file, "--replace", replace, "--with", with_,
        "--expect-fail", expect_fail,
    ]
    if nth is not None:
        argv += ["--nth", str(nth)]
    return subprocess.Popen(
        argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )


def _send_signal_mid_run_and_wait(repo: Path, proc: subprocess.Popen, sig: int) -> tuple[str, str]:
    try:
        _wait_for_state_file(repo)
        # sentinel 出現後再等一下，確保真的卡在突變後那次 pytest 執行中
        # （SLOW_TEST_SRC 的 sleep(1.5) 給了充裕的窗口），不是剛寫完 sentinel
        # 那一瞬間。
        time.sleep(0.3)
        proc.send_signal(sig)
        try:
            return proc.communicate(timeout=15.0)
        except subprocess.TimeoutExpired:
            proc.kill()
            return proc.communicate(timeout=5.0)
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.communicate(timeout=5.0)


def test_ac_sigterm_during_test_run_restores_clean_tip(tmp_path):
    """核心 AC：突變已套用、測試跑到一半時送 SIGTERM 給 mutate.py ——
    原檔必須已還原、git status 乾淨、tip 上沒有壞掉的內容。"""
    repo = make_scratch_repo(tmp_path)
    write_and_commit(repo, {"target.py": TARGET_SRC, "test_target.py": SLOW_TEST_SRC}, "init")

    proc = popen_mutate_cli(
        repo, file="target.py", replace="return a + b", with_="return a - b",
        expect_fail="test_target.py::test_add",
    )
    stdout, stderr = _send_signal_mid_run_and_wait(repo, proc, signal.SIGTERM)

    assert proc.returncode == 128 + signal.SIGTERM, (
        "被 SIGTERM 中斷的 exit code 應該是 signal handler 自己回報的 "
        f"128+{signal.SIGTERM}\nstdout:\n{stdout}\nstderr:\n{stderr}"
    )
    assert (repo / "target.py").read_text(encoding="utf-8") == TARGET_SRC, (
        "SIGTERM 中斷後原檔沒有還原！\nstdout:\n" + stdout + "\nstderr:\n" + stderr
    )
    status = _run_git(repo, "status", "--porcelain")
    assert status.stdout.strip() == "", f"SIGTERM 中斷後 git status 不乾淨:\n{status.stdout}"

    diff = _run_git(repo, "diff")
    log = _run_git(repo, "log", "--oneline", "-1")
    print("[驗收證據] git diff（應為空）:", repr(diff.stdout))
    print("[驗收證據] git log --oneline -1:", log.stdout.strip())

    assert not list(_state_dir(repo).glob("*.json")), "sentinel 狀態檔應該已被清掉"


def test_ac_sigkill_leaves_dirty_tip_until_self_heal_on_next_run(tmp_path):
    """第二層 AC：SIGKILL 攔不到任何 handler，中斷當下 tip 一定是髒的
    ——這正是 STORY-70-18 要修的事故形狀本身，不是要「假裝」SIGKILL 也能
    被攔下來。但下一次執行 mutate.py（同一個檔案，引數甚至不必相同）
    必須先自癒：偵測到殘留、印出訊息、把檔案還原、刪掉 sentinel，才繼續
    往下跑。"""
    repo = make_scratch_repo(tmp_path)
    write_and_commit(repo, {"target.py": TARGET_SRC, "test_target.py": SLOW_TEST_SRC}, "init")

    proc = popen_mutate_cli(
        repo, file="target.py", replace="return a + b", with_="return a - b",
        expect_fail="test_target.py::test_add",
    )
    _send_signal_mid_run_and_wait(repo, proc, signal.SIGKILL)

    dirty_content = (repo / "target.py").read_text(encoding="utf-8")
    assert dirty_content != TARGET_SRC, (
        "前提不成立：SIGKILL 之後檔案竟然沒有殘留突變內容，代表沒測到"
        "危險窗口，這條測試沒有測到 SIGKILL 真正的殺傷力。"
    )
    assert "return a - b" in dirty_content
    state_files_after_kill = list(_state_dir(repo).glob("*.json"))
    assert len(state_files_after_kill) == 1, (
        "SIGKILL 之後應該還留著一個沒被清掉的 sentinel 狀態檔"
    )
    status_after_kill = _run_git(repo, "status", "--porcelain")
    print("[驗收證據] SIGKILL 剛結束時 git status（預期非空，證明 tip 是髒的）:",
          repr(status_after_kill.stdout))

    heal_result = run_mutate_cli(
        repo, file="target.py", replace="return a + b", with_="return a * 100",
        expect_fail="test_target.py::test_add",
    )

    combined = heal_result.stdout + heal_result.stderr
    assert "自癒" in combined, "沒有印出自癒訊息:\n" + combined
    assert heal_result.returncode == 0, (
        "自癒後這次全新的突變測試應該正常跑完並回 0:\n" + combined
    )
    assert (repo / "target.py").read_text(encoding="utf-8") == TARGET_SRC, (
        "自癒 + 新一輪突變測試跑完後，檔案應該還原回原始內容"
    )
    assert not list(_state_dir(repo).glob("*.json")), "自癒後 sentinel 狀態檔應該清空"


def test_ac_self_heal_corrupted_state_file_exits_5_and_is_not_silently_dropped(tmp_path):
    """自癒狀態檔本身若損毀（理論上不該發生，但要求「不得靜默放行」），
    必須 exit 5、不嘗試任何突變、也不能默默刪掉還沒人看過的證據。"""
    repo = make_scratch_repo(tmp_path)
    write_and_commit(repo, {"target.py": TARGET_SRC, "test_target.py": TEST_SRC}, "init")

    state_dir = _state_dir(repo)
    state_dir.mkdir(parents=True)
    corrupted = state_dir / "deadbeef0000.json"
    corrupted.write_text("{not valid json", encoding="utf-8")

    result = run_mutate_cli(
        repo, file="target.py", replace="return a + b", with_="return a - b",
        expect_fail="test_target.py::test_add",
    )

    assert result.returncode == 5, result.stdout + result.stderr
    assert (repo / "target.py").read_text(encoding="utf-8") == TARGET_SRC
    assert corrupted.is_file(), "無法解析的狀態檔不該被靜默刪除"


def test_ac_normal_run_leaves_no_sentinel_state_file(tmp_path):
    """正常路徑零回歸：沒被中斷時，跑完不該留下任何 sentinel 殘骸。"""
    repo = make_scratch_repo(tmp_path)
    write_and_commit(repo, {"target.py": TARGET_SRC, "test_target.py": TEST_SRC}, "init")

    result = run_mutate_cli(
        repo, file="target.py", replace="return a + b", with_="return a - b",
        expect_fail="test_target.py::test_add",
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert not list(_state_dir(repo).glob("*.json"))


def test_ac_teeth_disabling_signal_restore_makes_sigterm_leave_dirty_tip(tmp_path):
    """證明有牙：把本工單修的「SIGTERM 收到訊號就還原」拔掉（signal handler
    改註冊成「不處理」，等於沒裝這個 handler），對同一個中斷情境重跑一次
    ——tip 必須變髒（不還原）。真的拔掉修法會讓中斷測試從綠翻紅，證明
    test_ac_sigterm_during_test_run_restores_clean_tip 真的測到這個機制，
    不是巧合綠。"""
    mutate_py_text = MUTATE_PY.read_text(encoding="utf-8")
    disable_target = "signal.signal(signal.SIGTERM, _handle_kill_signal)"
    assert mutate_py_text.count(disable_target) == 1, (
        "找不到唯一一處要拔掉的 SIGTERM handler 註冊行，本測試的前提已經過期，"
        "請對照目前 dev/tools/mutate.py 的 _install_signal_handlers() 更新這條測試"
    )
    broken_text = mutate_py_text.replace(
        disable_target, "signal.signal(signal.SIGTERM, signal.SIG_DFL)"
    )
    broken_mutate_py = tmp_path / "broken_mutate.py"
    broken_mutate_py.write_text(broken_text, encoding="utf-8")

    repo = make_scratch_repo(tmp_path, name="teeth_scratch")
    write_and_commit(repo, {"target.py": TARGET_SRC, "test_target.py": SLOW_TEST_SRC}, "init")

    proc = popen_mutate_cli(
        repo, file="target.py", replace="return a + b", with_="return a - b",
        expect_fail="test_target.py::test_add", mutate_py=broken_mutate_py,
    )
    stdout, stderr = _send_signal_mid_run_and_wait(repo, proc, signal.SIGTERM)

    dirty_content = (repo / "target.py").read_text(encoding="utf-8")
    assert dirty_content != TARGET_SRC, (
        "拔掉 SIGTERM handler 之後，這個中斷情境竟然還是自動還原了——代表"
        "test_ac_sigterm_during_test_run_restores_clean_tip 沒有真的測到"
        "本工單修的機制（或有別的東西在做還原）。\n"
        f"broken driver: {broken_mutate_py}\nstdout:\n{stdout}\nstderr:\n{stderr}"
    )
    assert "return a - b" in dirty_content
