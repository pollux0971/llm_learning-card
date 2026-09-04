# SOURCE: template v1.3.2 (7eecc51) sha256=64d9ae4fdc10a05379fa6b63456b5e368bd57f655000dc7c8a568ae26ee04dec — 勿手改;升版用 sync-gates.sh
#!/usr/bin/env python3
# SOURCE: nightmare-assault (project C) dev/tools/mutate.py @ 4f1948ac, adopted into template 1.3.1 with user approval 2026-09-05
"""安全的突變測試（mutation testing）驅動工具 — STORY-61-21。

用「`git checkout`」加「兩個 dash」把整個檔案還原成 index/HEAD 版本，已經
在本專案造成兩次資料遺失事故（`STORY-60-27`、`STORY-62-02` Phase 3）：
突變測試的自然流程是「改壞 → 看測試變紅 → 改回來」，而「改回來」最直覺
的指令就是那個會清空工作區的 checkout 用法——它會連同同一檔案裡其他未
commit 的合法編輯一起清空。口頭禁令已證明擋不住這個直覺。本工具把「安全
的改回來」變成唯一路徑：只用 `git show <sha>:<path>` 讀取 git object 內容
寫回檔案，**絕不**呼叫 `CLAUDE.md §7` 禁用清單上的任何一個指令（本檔連
在註解裡都刻意不拼出那些完整指令字面，見下方 grep 驗收要求；只用「兩個
dash 版的 checkout」／「hard 重置」／「強制清未追蹤檔」這類描述帶過）。

流程：
  1. 檢查目標檔是否有未 commit 的變更 —— 有就先自動 WIP commit 封存
     （只 commit 這一個檔案，不動其他任何檔案），絕不在未封存前動手。
  2. 記錄封存後的內容（bytes + sha256）與 git blob sha（`HEAD:<path>`）。
  3. 套用突變（字面字串取代）。
  4. 跑 `--expect-fail` 指定的 pytest node id，斷言它真的變紅
     （沒變紅 = 這個突變測試沒有測到東西，回非零 exit code 並說明原因，
     不得靜默放行）。
  5. 用 `git show <sha>:<path>` 讀回封存時的內容寫回檔案（不用 checkout）。
  6. 驗證還原後的內容與封存時逐位元相同（sha256 比對），不一致就大聲失敗。
  7. 印出可直接貼進 EVIDENCE 的完整記錄。

repo root 用 `git rev-parse --show-toplevel`（依目前工作目錄，非依本檔案
所在位置）現場偵測——跟真正的 `git` 指令行為一致，也讓自動化測試可以把
它指向一個一次性的暫存 repo，不會每次跑測試都在本專案真正的 git 歷史裡
留下 WIP commit。

用法：
  python3 dev/tools/mutate.py \\
      --file core/mystery/authority.py \\
      --replace '"core": _CASE_WRITER_POLICY' \\
      --with    '"core": dict(_CASE_WRITER_POLICY)' \\
      --expect-fail tests/test_story_62_14.py::test_core_delegates_by_reference

機器負載高時，「紅」有可能不是突變造成的，是 timeout／環境問題造成的假紅
（見 STORY-61-21 dispatcher 補充意見）。本工具因此不只看「有沒有變紅」，
還要求：(a) 突變**之前**先跑一次同一個 node id 確認是乾淨的綠（0），
(b) 突變**之後**的紅必須是 pytest exit code 1（真的斷言失敗），不是
2/3/4/5（中斷/內部錯誤/用法錯誤/沒收集到測試）這類跟斷言邏輯無關的
非零碼——只有「綠 → 真的斷言失敗的紅」才算突變測試通過。

--replace 指定的字串在檔案裡必須恰好出現一次，否則「測試變紅」無法歸因到
單一位置（STORY-70-14）。出現多次時一律拒絕並印出每一處的行號；要突變其中
特定一處，加 `--nth N`（1-indexed）明示。

Exit code：
  0 = 突變前綠、突變後因斷言失敗變紅，已安全還原並驗證一致
  1 = 使用方式錯誤（引數、檔案不存在、不受 git 追蹤、取代字串找不到、
      取代字串出現次數非唯一且未給 --nth、--nth 超出範圍、
      或突變前這個 node id 就不是乾淨的綠）
  2 = 突變沒有讓測試變紅（突變測試本身無效）—— 檔案已還原
  3 = 還原後 hash 不一致（嚴重錯誤，理論上不應發生）
  4 = 無法判定：突變後的非零 exit code 不是 1（可能是 timeout/環境問題造
      成的假紅）—— 檔案已還原，不能當作突變生效的證據
  5 = 上次執行留下的自癒狀態檔無法解析（見下方「被中斷時」說明）——
      需要人工介入，不會自動嘗試突變

被中斷時（STORY-70-18）：
  高負載機器上，本工具跑到一半可能被訊號殺掉（背景 pytest 過去兩天已
  發生三次），若壞掉的檔案留在磁碟上、被之後的 WIP commit 順手掃進
  branch tip，「證明有牙」的證據鏈就整條斷掉。因此兩層防線：
  (a) 套用突變前註冊 SIGTERM/SIGINT handler：收到訊號時立刻用
      `git show <sha>:<path>` 還原並結束，跟正常路徑走同一套還原邏輯。
  (b) SIGKILL 攔不到訊號，所以套用突變前先把「還原需要的資訊」
      （root-relative 路徑 + git blob sha）寫進一個不受 git 追蹤的
      sentinel 檔（`<git-dir>/mutate-state/<hash>.json`，`git-dir` 用
      `git rev-parse --git-dir` 現場偵測，天生每個 worktree各自獨立）；
      任何一次呼叫本工具（含跟這次目標檔無關的呼叫）都會先掃這個目錄，
      發現殘留就自動還原、印出訊息、刪除 sentinel，再繼續往下跑
      ——下一次執行本身就是自癒點，不需要使用者記得手動處理。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import subprocess
import sys
from pathlib import Path


class MutateError(RuntimeError):
    def __init__(self, message: str, exit_code: int = 1):
        super().__init__(message)
        self.exit_code = exit_code


# STORY-70-18：目前進行中的突變（若有）的還原資訊。只有 SIGTERM/SIGINT
# 這種可攔截的訊號才會用到它——SIGKILL 攔不到 handler，靠磁碟上的
# sentinel 檔在下一次執行時自癒（見 _self_heal）。
_ACTIVE: dict[str, object] | None = None


def _handle_kill_signal(signum: int, frame) -> None:  # noqa: ANN001 - signal handler signature
    state = _ACTIVE
    if state is not None:
        try:
            restored = _read_blob_bytes(state["root"], state["orig_sha"])  # type: ignore[arg-type]
            state["abs_path"].write_bytes(restored)  # type: ignore[union-attr]
        except Exception as e:  # pragma: no cover - 還原本身壞掉時別再拋例外
            print(
                f"[mutate.py] 收到訊號 {signum}，但緊急還原失敗（{e}）——"
                f"下次執行 mutate.py 時的自癒機制會再嘗試一次。",
                file=sys.stderr,
            )
        else:
            try:
                state["state_file"].unlink(missing_ok=True)  # type: ignore[union-attr]
            except Exception:  # pragma: no cover
                pass
            print(
                f"[mutate.py] 收到訊號 {signum}，已在結束前還原 "
                f"{state['rel_path']}（git show {state['orig_sha']}:"
                f"{state['rel_path']}）。",
                file=sys.stderr,
            )
    os._exit(128 + signum)


def _install_signal_handlers() -> None:
    signal.signal(signal.SIGTERM, _handle_kill_signal)
    signal.signal(signal.SIGINT, _handle_kill_signal)


def find_repo_root(start: Path | None = None) -> Path:
    r = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], cwd=start or Path.cwd(),
        capture_output=True, text=True, check=False,
    )
    if r.returncode != 0:
        raise MutateError(f"目前位置不在一個 git repo 裡: {r.stderr.strip()}")
    return Path(r.stdout.strip())


def _run_git(root: Path, args: list[str], *, capture_bytes: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=root,
        capture_output=True, text=not capture_bytes, check=False,
    )


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _ensure_tracked(root: Path, rel_path: str) -> None:
    r = _run_git(root, ["ls-files", "--error-unmatch", "--", rel_path])
    if r.returncode != 0:
        raise MutateError(
            f"{rel_path} 不受 git 追蹤（未 commit 過）——本工具的還原機制依賴 "
            f"git object，請先 commit 這個檔案再跑突變測試。\nstderr: {r.stderr}"
        )


def _has_uncommitted_changes(root: Path, rel_path: str) -> bool:
    r = _run_git(root, ["status", "--porcelain", "--", rel_path])
    if r.returncode != 0:
        raise MutateError(f"git status 失敗: {r.stderr}")
    return bool(r.stdout.strip())


def _wip_commit(root: Path, rel_path: str) -> None:
    """只 commit 這一個檔案，絕不動其他任何檔案（`git add -- <path>`，
    不是 `git add -A`），封存目標檔目前的未 commit 內容，讓後續的突變/還原
    有一個安全的還原點。"""
    r = _run_git(root, ["add", "--", rel_path])
    if r.returncode != 0:
        raise MutateError(f"git add {rel_path} 失敗: {r.stderr}")
    r = _run_git(root, [
        "commit", "-m",
        f"WIP(mutate.py): 突變測試前自動封存 {rel_path}（STORY-61-21）",
        "--", rel_path,
    ])
    if r.returncode != 0:
        raise MutateError(f"git commit {rel_path} 失敗: {r.stderr}")


def _git_dir(root: Path) -> Path:
    r = _run_git(root, ["rev-parse", "--git-dir"])
    if r.returncode != 0:
        raise MutateError(f"讀取 git-dir 失敗: {r.stderr}")
    p = Path(r.stdout.strip())
    return p if p.is_absolute() else (root / p)


def _state_dir(root: Path) -> Path:
    # 每個 worktree 的 --git-dir 都不同（worktree 的是
    # `<main>/.git/worktrees/<name>`），sentinel 天生不會跨 worktree 互相
    # 干擾，也不受 git 追蹤（不會被誤 commit）。
    return _git_dir(root) / "mutate-state"


def _state_file_for(root: Path, rel_path: str) -> Path:
    key = hashlib.sha256(rel_path.encode("utf-8")).hexdigest()[:16]
    return _state_dir(root) / f"{key}.json"


def _write_state_file(root: Path, rel_path: str, orig_sha: str) -> Path:
    state_file = _state_file_for(root, rel_path)
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(
        json.dumps({"rel_path": rel_path, "orig_sha": orig_sha, "pid": os.getpid()}),
        encoding="utf-8",
    )
    return state_file


def _self_heal(root: Path) -> None:
    """STORY-70-18：在做任何事之前，先檢查有沒有上一次執行留下的、未還原
    完成的突變（SIGKILL 讓 signal handler 完全來不及跑時就會發生）。有就
    先還原、印出訊息、刪除 sentinel，再讓這次呼叫繼續往下跑——下一次
    呼叫本身就是自癒點，不靠使用者記得。"""
    state_dir = _state_dir(root)
    if not state_dir.is_dir():
        return
    for state_file in sorted(state_dir.glob("*.json")):
        try:
            data = json.loads(state_file.read_text(encoding="utf-8"))
            rel_path = data["rel_path"]
            orig_sha = data["orig_sha"]
        except Exception as e:
            raise MutateError(
                f"偵測到上次執行留下的自癒狀態檔 {state_file} 但內容無法解析"
                f"（{e}）——不會自動嘗試突變。請人工檢查該檔案內容，找到 "
                f"rel_path/orig_sha 後執行「git show <orig_sha>:<rel_path> > "
                f"<rel_path>」手動還原，確認 `git status` 乾淨後刪除 "
                f"{state_file}，再重跑本工具。",
                exit_code=5,
            )
        abs_path = root / rel_path
        restored = _read_blob_bytes(root, orig_sha)
        abs_path.write_bytes(restored)
        state_file.unlink()
        print(
            f"[mutate.py] 自癒：偵測到上次執行未完成的突變殘留（{rel_path}，"
            f"可能死於 SIGKILL 或崩潰），已用 git show {orig_sha}:{rel_path} "
            f"還原並刪除殘留狀態檔 {state_file.name}。",
            file=sys.stderr,
        )


def _blob_sha(root: Path, rel_path: str) -> str:
    r = _run_git(root, ["rev-parse", f"HEAD:{rel_path}"])
    if r.returncode != 0:
        raise MutateError(f"讀取 HEAD:{rel_path} 的 git blob sha 失敗: {r.stderr}")
    return r.stdout.strip()


def _read_blob_bytes(root: Path, sha: str) -> bytes:
    r = _run_git(root, ["show", sha], capture_bytes=True)
    if r.returncode != 0:
        raise MutateError(f"git show {sha} 失敗: {r.stderr}")
    return r.stdout


def _find_occurrence_offsets(text: str, needle: str) -> list[int]:
    """回傳 needle 在 text 裡每一次出現的字元 offset（非重疊，語義對齊
    `str.count`——`str.count` 也是非重疊計數，兩者算出的次數必須一致，
    否則 --nth 選中的位置會跟使用者以為的「第幾次出現」對不上。"""
    offsets: list[int] = []
    start = 0
    while True:
        idx = text.find(needle, start)
        if idx == -1:
            break
        offsets.append(idx)
        start = idx + len(needle)
    return offsets


def _offset_to_line(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def _run_pytest(root: Path, node_id: str) -> subprocess.CompletedProcess:
    # STORY-70-13：突變前後兩次 pytest 是各自獨立的 subprocess，中間只隔著
    # 一次檔案寫入。若目標檔的 __pycache__ 沿用 32-bit 整數秒精度的 mtime
    # 比對，兩次呼叫落在同一秒內就會讓突變後那次 import 到突變前殘留的舊
    # bytecode，讓真正會讓測試變紅的突變被靜默吃掉（實測會重現、非恆定發
    # 生——時機取決於執行速度）。禁止這兩次呼叫寫入/沿用任何 .pyc，確保
    # 突變後永遠從磁碟上「當下」的原始碼重新編譯。
    env = dict(os.environ)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return subprocess.run(
        [sys.executable, "-m", "pytest", node_id, "-q"],
        cwd=root, capture_output=True, text=True, check=False,
        env=env,
    )


def run_mutation(
    *, root: Path, file: str, replace: str, with_: str, expect_fail: str,
    nth: int | None = None,
) -> int:
    global _ACTIVE
    # STORY-70-18：在動任何東西之前，先處理上一次執行可能留下的爛攤子
    # （SIGKILL 讓下面註冊的 signal handler 完全來不及跑）。
    _self_heal(root)
    _install_signal_handlers()

    abs_path = (root / file).resolve()
    if not abs_path.is_file():
        raise MutateError(f"檔案不存在: {file}", exit_code=1)

    rel_path = str(abs_path.relative_to(root))
    _ensure_tracked(root, rel_path)

    committed_wip = False
    if _has_uncommitted_changes(root, rel_path):
        _wip_commit(root, rel_path)
        committed_wip = True

    orig_sha = _blob_sha(root, rel_path)
    orig_bytes = abs_path.read_bytes()
    orig_hash = _sha256(orig_bytes)

    # 保險：git blob 內容必須真的等於目前檔案內容（committed_wip 分支剛
    # commit 過理應一致；否則代表工作區跟 index/HEAD 有本工具沒預期到的
    # 落差，寧可提早失敗也不要在錯的基準上做突變）。
    blob_bytes = _read_blob_bytes(root, orig_sha)
    if blob_bytes != orig_bytes:
        raise MutateError(
            "內部一致性檢查失敗：git blob 內容與檔案目前內容不同，拒絕繼續 "
            "（可能代表檔案已被 commit 之外的方式修改）。未套用任何突變。",
            exit_code=1,
        )

    orig_text = orig_bytes.decode("utf-8")
    offsets = _find_occurrence_offsets(orig_text, replace)
    occurrences = len(offsets)
    if occurrences == 0:
        raise MutateError(
            f"在 {rel_path} 裡找不到 --replace 指定的字面字串，未套用任何突變：\n"
            f"  {replace!r}",
            exit_code=1,
        )

    # STORY-70-14：occurrences 算出來卻只拿去擋 0 的舊版本，真正套用突變時
    # 用 str.replace() 把每一處符合的字串都改掉——測試變紅之後無法歸因到
    # 工單宣稱的那一個位置，稀釋了「證明有牙」的證據力。因此 occurrences
    # 不是 1 時一律拒絕執行（除非明確給 --nth 指定要動第幾處）。
    if nth is None:
        if occurrences != 1:
            line_numbers = [_offset_to_line(orig_text, o) for o in offsets]
            raise MutateError(
                f"--replace 指定的字串在 {rel_path} 出現 {occurrences} 次（非唯一），"
                f"無法歸因是哪一處被突變，未套用任何突變。出現的行號：{line_numbers}。"
                f"請改用只出現一次的字串，或加 --nth N 明示要突變第幾處。",
                exit_code=1,
            )
        target_offset = offsets[0]
    else:
        if nth < 1 or nth > occurrences:
            raise MutateError(
                f"--nth {nth} 超出範圍：--replace 指定的字串在 {rel_path} "
                f"只出現 {occurrences} 次。",
                exit_code=1,
            )
        target_offset = offsets[nth - 1]

    # 「綠 → 紅」而非只看「紅」：機器負載高時，測試可能因為 timeout／
    # 環境問題本身就是紅的，或因為 collection error/interrupted 這類跟
    # 斷言邏輯無關的原因回非 0——那種「紅」不能證明突變真的生效，反而會
    # 製造假的突變測試通過紀錄（正是紅線 3 想擋的事，只是換了個方向）。
    # 先在**突變前**跑一次同一個 node id，要求它是乾淨的 0（真的綠、真的
    # 有被收集到），沒有這個基準就沒資格宣稱後面的紅是突變造成的。
    print(f"[mutate.py] 突變前先跑一次基準（應為綠）: {expect_fail}")
    baseline = _run_pytest(root, expect_fail)
    print(f"[mutate.py] 基準 pytest exit code = {baseline.returncode}")
    if baseline.returncode != 0:
        raise MutateError(
            f"{expect_fail} 在套用突變之前就不是綠的（exit code "
            f"{baseline.returncode}）——這個測試不是有效的突變測試基準，"
            f"無法證明後面的紅是突變造成還是本來就紅（或環境問題）。"
            f"未套用任何突變。\npytest 輸出尾段:\n"
            + "\n".join(baseline.stdout.splitlines()[-20:]),
            exit_code=1,
        )

    mutated_text = (
        orig_text[:target_offset] + with_ + orig_text[target_offset + len(replace):]
    )

    # STORY-70-18：從這裡開始到還原完成之前是「危險窗口」——sentinel 檔
    # 跟 _ACTIVE 必須在寫壞檔案**之前**就位，這樣就算訊號剛好卡在寫檔那一
    # 行也還原得回來（sentinel 記的是還原用的 blob sha，不是「已套用突
    # 變」的旗標，寫兩次還原也是還原到同一份乾淨內容，安全）。
    state_file = _write_state_file(root, rel_path, orig_sha)
    _ACTIVE = {
        "root": root, "abs_path": abs_path, "rel_path": rel_path,
        "orig_sha": orig_sha, "state_file": state_file,
    }

    print(f"[mutate.py] 已封存基準（WIP commit: {committed_wip}），blob sha = {orig_sha}")
    print(
        f"[mutate.py] 套用突變於 {rel_path}（共 {occurrences} 處出現，"
        f"只取代第 {nth or 1} 處，行號 {_offset_to_line(orig_text, target_offset)}）"
    )
    print(f"[mutate.py] 跑測試（突變後）: {expect_fail}")

    try:
        abs_path.write_text(mutated_text, encoding="utf-8")
        result = _run_pytest(root, expect_fail)
        # pytest exit code：0=全過，1=有斷言失敗，2=中斷，3=內部錯誤，
        # 4=用法錯誤，5=沒收集到測試。只有 1（真的斷言失敗）才算「因為
        # 正確的原因變紅」；2/3/4/5 代表這次執行本身不可信（可能是
        # timeout 或環境問題造成的假紅），不能當成突變生效的證據。
        print(f"[mutate.py] 突變後 pytest exit code = {result.returncode}")
        tail = "\n".join(result.stdout.splitlines()[-20:])
        print(f"[mutate.py] pytest 輸出（尾 20 行）:\n{tail}")
        outcome = (
            "assertion_failed" if result.returncode == 1
            else "passed" if result.returncode == 0
            else "inconclusive"
        )
    finally:
        # 無論測試跑成怎樣（含拋例外），都一定要走到還原這一步——
        # 這是紅線 2「未 commit 變更未被封存前絕不修改檔案」的另一半：
        # 已修改的檔案絕不能因為中途出錯就留在突變狀態。
        restored_bytes = _read_blob_bytes(root, orig_sha)
        abs_path.write_bytes(restored_bytes)
        restored_hash = _sha256(restored_bytes)
        # 危險窗口結束：sentinel 已經沒用了，刪掉；訊號 handler 之後不該
        # 再對這個（已經還原過的）檔案做任何事。
        state_file.unlink(missing_ok=True)
        _ACTIVE = None
        if restored_hash != orig_hash:
            print(
                f"[mutate.py] 嚴重錯誤：還原後 hash 不一致！"
                f"\n  預期: {orig_hash}\n  實際: {restored_hash}",
                file=sys.stderr,
            )
            return 3
        print(f"[mutate.py] 已用 git show {orig_sha}:{rel_path} 還原，hash 比對一致（{restored_hash}）")

    if outcome == "passed":
        print(
            f"[mutate.py] 突變測試無效：套用突變後 {expect_fail} 仍然通過"
            f"（exit code 0，且突變前也是綠的，不是環境問題）——這個突變"
            f"沒有測到任何東西。檔案已安全還原，但這代表 --replace/--with "
            f"或 --expect-fail 需要重新設計。",
            file=sys.stderr,
        )
        return 2

    if outcome == "inconclusive":
        print(
            f"[mutate.py] 無法判定：突變後 pytest exit code = {result.returncode}"
            f"（不是 0 也不是 1，代表中斷/內部錯誤/用法錯誤/沒收集到測試，"
            f"不是真的斷言失敗）——負載高的機器上常見成因是 timeout 或環境"
            f"問題，不能當成突變生效的證據。檔案已安全還原，請確認機器負載"
            f"、換一個更穩定的目標測試，或稍後重試。",
            file=sys.stderr,
        )
        return 4

    print(
        f"[mutate.py] 突變測試通過：{expect_fail} 突變前綠、突變後真的因斷言"
        f"失敗變紅（exit code 1，非 timeout/環境問題），已安全還原並驗證一致。"
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="安全的突變測試驅動工具（不用兩個 dash 版的 checkout 還原，見 STORY-61-21）",
    )
    parser.add_argument("--file", required=True, help="要突變的檔案路徑（相對 repo 根目錄）")
    parser.add_argument("--replace", required=True, help="要被取代的字面字串（非 regex）")
    parser.add_argument("--with", dest="with_", required=True, help="取代成的字面字串")
    parser.add_argument("--expect-fail", required=True,
                        help="套用突變後應該變紅的 pytest node id，例如 tests/foo.py::test_bar")
    parser.add_argument("--nth", type=int, default=None,
                        help="--replace 字串出現多次時，明示要突變第幾處（1-indexed）。"
                             "省略時要求 --replace 只能出現恰好一次，否則拒絕執行。")
    args = parser.parse_args(argv)

    try:
        root = find_repo_root()
        return run_mutation(
            root=root, file=args.file, replace=args.replace, with_=args.with_,
            expect_fail=args.expect_fail, nth=args.nth,
        )
    except MutateError as e:
        print(f"[mutate.py] 錯誤: {e}", file=sys.stderr)
        return e.exit_code


if __name__ == "__main__":
    sys.exit(main())
