/*
 * 10-desktop-shell phase-2 的測試用 LD_PRELOAD shim(T2c-1,測試 agent 寫的,實作者不要改)。
 *
 * 用途:在**真的** lc-fs 二進位上(不是 Rust 的測試替身)
 *   1. 記下目標目錄裡發生的系統呼叫,順序與 fd 都記(§11b 四步、log 一次 write);
 *   2. 在第 n 次某個呼叫注入 errno(T7 共用向量的 inject 欄,與 TS harness 同一套名字)。
 *
 * 呼叫名跟 packages/core/src/schema/atomic-write.vectors.json 的 inject.call 一樣:
 *   open:tmp | write | fsync:file | close:file | rename | open:dir | fsync:dir | close:dir | unlink
 * 另外兩組只用在 log.jsonl:用 O_APPEND 開的檔記成 open:append / write:append / fsync:append / close:append。
 * 目標目錄裡用別的旗標開、但不是 <name>.tmp 的檔,記成 open:file(write / fsync / close 仍記成 :file)。
 *
 * 只追蹤路徑的父目錄等於 LC_SHIM_DIR、或路徑就是 LC_SHIM_DIR 的呼叫,以及由這些 open 拿到的 fd。
 * 其他(stdin/stdout、載入函式庫、readdir 內部的 open)一律不記、不注入。
 *
 * 環境變數:
 *   LC_SHIM_DIR     絕對路徑,已經 realpath 過(learning_fs 會 canonicalize 根目錄)。
 *   LC_SHIM_TRACE   追蹤檔的絕對路徑(放在 LC_SHIM_DIR 外面)。
 *   LC_SHIM_INJECT  逗號分隔的 <call>@<nth>@<ERRNO>,例如 rename@1@EXDEV,unlink@1@EPERM。
 *
 * 追蹤檔一行一個呼叫,欄位以 TAB 分隔:
 *   <call>  path=<路徑>  fd=<n>  flags=<十進位>  len=<n>  to=<路徑>  injected=<ERRNO>
 * 只出現跟該呼叫有關的欄位。追蹤檔用 syscall() 直接寫,不經過被攔的 write。
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

#define MAX_FD 4096
#define MAX_INJECT 16
#define MAX_COUNTERS 32

enum kind { K_NONE = 0, K_FILE, K_TMP, K_DIR, K_APPEND };

static enum kind fd_kind[MAX_FD];
static const char *shim_dir;
static size_t shim_dir_len;
static int trace_fd = -1;
static int ready;

struct inject {
  char call[32];
  int nth;
  int err;
};
static struct inject injects[MAX_INJECT];
static int n_injects;

struct counter {
  char call[32];
  int seen;
};
static struct counter counters[MAX_COUNTERS];
static int n_counters;

static int errno_of(const char *name) {
  if (!strcmp(name, "EXDEV")) return EXDEV;
  if (!strcmp(name, "EPERM")) return EPERM;
  if (!strcmp(name, "EINVAL")) return EINVAL;
  if (!strcmp(name, "EIO")) return EIO;
  if (!strcmp(name, "ENOSPC")) return ENOSPC;
  if (!strcmp(name, "EACCES")) return EACCES;
  if (!strcmp(name, "ENOENT")) return ENOENT;
  return 0;
}

static const char *name_of(int err) {
  switch (err) {
    case EXDEV: return "EXDEV";
    case EPERM: return "EPERM";
    case EINVAL: return "EINVAL";
    case EIO: return "EIO";
    case ENOSPC: return "ENOSPC";
    case EACCES: return "EACCES";
    case ENOENT: return "ENOENT";
    default: return "E?";
  }
}

static void init(void) {
  if (ready) return;
  ready = 1;
  shim_dir = getenv("LC_SHIM_DIR");
  shim_dir_len = shim_dir ? strlen(shim_dir) : 0;
  const char *trace = getenv("LC_SHIM_TRACE");
  if (trace) {
    trace_fd = (int)syscall(SYS_openat, AT_FDCWD, trace, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644);
  }
  const char *spec = getenv("LC_SHIM_INJECT");
  if (spec && *spec) {
    char buf[1024];
    strncpy(buf, spec, sizeof(buf) - 1);
    buf[sizeof(buf) - 1] = '\0';
    char *save = NULL;
    for (char *tok = strtok_r(buf, ",", &save); tok && n_injects < MAX_INJECT; tok = strtok_r(NULL, ",", &save)) {
      char *at1 = strchr(tok, '@');
      if (!at1) continue;
      char *at2 = strchr(at1 + 1, '@');
      if (!at2) continue;
      *at1 = '\0';
      *at2 = '\0';
      struct inject *in = &injects[n_injects++];
      strncpy(in->call, tok, sizeof(in->call) - 1);
      in->nth = atoi(at1 + 1);
      in->err = errno_of(at2 + 1);
    }
  }
}

/* 路徑的父目錄就是 LC_SHIM_DIR(直接子項),或路徑就是 LC_SHIM_DIR。 */
static int in_dir(const char *path, int *is_dir) {
  *is_dir = 0;
  if (!shim_dir || !path || path[0] != '/') return 0;
  if (strncmp(path, shim_dir, shim_dir_len) != 0) return 0;
  const char *rest = path + shim_dir_len;
  if (*rest == '\0') {
    *is_dir = 1;
    return 1;
  }
  if (rest[0] == '/' && rest[1] == '\0') {
    *is_dir = 1;
    return 1;
  }
  if (rest[0] != '/') return 0;
  return strchr(rest + 1, '/') == NULL;
}

static int ends_with_tmp(const char *path) {
  size_t n = strlen(path);
  return n > 4 && strcmp(path + n - 4, ".tmp") == 0;
}

static void emit(const char *line) {
  if (trace_fd >= 0) syscall(SYS_write, trace_fd, line, strlen(line));
}

/* 先記一次再判斷要不要注入(跟 TS harness 的順序一樣:calls.push 之後才 maybeInject)。 */
static int take_inject(const char *call) {
  struct counter *c = NULL;
  for (int i = 0; i < n_counters; i++) {
    if (!strcmp(counters[i].call, call)) {
      c = &counters[i];
      break;
    }
  }
  if (!c && n_counters < MAX_COUNTERS) {
    c = &counters[n_counters++];
    strncpy(c->call, call, sizeof(c->call) - 1);
    c->seen = 0;
  }
  if (!c) return 0;
  c->seen++;
  for (int i = 0; i < n_injects; i++) {
    if (!strcmp(injects[i].call, call) && injects[i].nth == c->seen) return injects[i].err;
  }
  return 0;
}

static const char *suffix_of(enum kind k) {
  switch (k) {
    case K_DIR: return "dir";
    case K_APPEND: return "append";
    default: return "file";
  }
}

static int (*real_open64)(const char *, int, ...);
static int (*real_open)(const char *, int, ...);
static int (*real_openat)(int, const char *, int, ...);
static int (*real_openat64)(int, const char *, int, ...);
static ssize_t (*real_write)(int, const void *, size_t);
static int (*real_fsync)(int);
static int (*real_fdatasync)(int);
static int (*real_close)(int);
static int (*real_rename)(const char *, const char *);
static int (*real_renameat)(int, const char *, int, const char *);
static int (*real_renameat2)(int, const char *, int, const char *, unsigned int);
static int (*real_unlink)(const char *);
static int (*real_unlinkat)(int, const char *, int);

#define RESOLVE(name) \
  do { \
    if (!real_##name) real_##name = dlsym(RTLD_NEXT, #name); \
  } while (0)

static int traced_open(int dirfd, const char *path, int flags, mode_t mode, int which) {
  init();
  int is_dir = 0;
  int tracked = (dirfd == AT_FDCWD || path[0] == '/') && in_dir(path, &is_dir);
  enum kind k = K_NONE;
  const char *call = NULL;
  if (tracked) {
    if (is_dir || (flags & O_DIRECTORY)) {
      k = K_DIR;
      call = "open:dir";
    } else if (flags & O_APPEND) {
      k = K_APPEND;
      call = "open:append";
    } else if (ends_with_tmp(path)) {
      k = K_TMP;
      call = "open:tmp";
    } else {
      k = K_FILE;
      call = "open:file";
    }
  }
  int err = call ? take_inject(call) : 0;
  int fd;
  if (err) {
    fd = -1;
  } else if (which == 0) {
    RESOLVE(open64);
    fd = real_open64(path, flags, mode);
  } else if (which == 1) {
    RESOLVE(open);
    fd = real_open(path, flags, mode);
  } else if (which == 2) {
    RESOLVE(openat);
    fd = real_openat(dirfd, path, flags, mode);
  } else {
    RESOLVE(openat64);
    fd = real_openat64(dirfd, path, flags, mode);
  }
  int saved = errno;
  if (call) {
    char line[4400];
    if (err) {
      snprintf(line, sizeof(line), "%s\tpath=%s\tflags=%d\tinjected=%s\n", call, path, flags, name_of(err));
    } else {
      snprintf(line, sizeof(line), "%s\tpath=%s\tflags=%d\tfd=%d\n", call, path, flags, fd);
    }
    emit(line);
    if (fd >= 0 && fd < MAX_FD) fd_kind[fd] = k;
  }
  if (err) {
    errno = err;
    return -1;
  }
  errno = saved;
  return fd;
}

static mode_t mode_arg(int flags, va_list ap) {
  if (flags & (O_CREAT | __O_TMPFILE)) return (mode_t)va_arg(ap, int);
  return 0;
}

int open64(const char *path, int flags, ...) {
  va_list ap;
  va_start(ap, flags);
  mode_t mode = mode_arg(flags, ap);
  va_end(ap);
  return traced_open(AT_FDCWD, path, flags, mode, 0);
}

int open(const char *path, int flags, ...) {
  va_list ap;
  va_start(ap, flags);
  mode_t mode = mode_arg(flags, ap);
  va_end(ap);
  return traced_open(AT_FDCWD, path, flags, mode, 1);
}

int openat(int dirfd, const char *path, int flags, ...) {
  va_list ap;
  va_start(ap, flags);
  mode_t mode = mode_arg(flags, ap);
  va_end(ap);
  return traced_open(dirfd, path, flags, mode, 2);
}

int openat64(int dirfd, const char *path, int flags, ...) {
  va_list ap;
  va_start(ap, flags);
  mode_t mode = mode_arg(flags, ap);
  va_end(ap);
  return traced_open(dirfd, path, flags, mode, 3);
}

static enum kind kind_of_fd(int fd) {
  if (fd < 0 || fd >= MAX_FD) return K_NONE;
  return fd_kind[fd];
}

ssize_t write(int fd, const void *buf, size_t count) {
  init();
  RESOLVE(write);
  enum kind k = kind_of_fd(fd);
  if (k == K_NONE) return real_write(fd, buf, count);
  const char *call = k == K_APPEND ? "write:append" : "write";
  int err = take_inject(call);
  char line[256];
  if (err) {
    snprintf(line, sizeof(line), "%s\tfd=%d\tlen=%zu\tinjected=%s\n", call, fd, count, name_of(err));
    emit(line);
    errno = err;
    return -1;
  }
  ssize_t n = real_write(fd, buf, count);
  int saved = errno;
  snprintf(line, sizeof(line), "%s\tfd=%d\tlen=%zu\twrote=%zd\n", call, fd, count, n);
  emit(line);
  errno = saved;
  return n;
}

static int traced_sync(int fd, int data_only) {
  init();
  enum kind k = kind_of_fd(fd);
  if (k == K_NONE) {
    if (data_only) {
      RESOLVE(fdatasync);
      return real_fdatasync(fd);
    }
    RESOLVE(fsync);
    return real_fsync(fd);
  }
  char call[32];
  snprintf(call, sizeof(call), "fsync:%s", suffix_of(k));
  int err = take_inject(call);
  char line[256];
  if (err) {
    snprintf(line, sizeof(line), "%s\tfd=%d\tinjected=%s\n", call, fd, name_of(err));
    emit(line);
    errno = err;
    return -1;
  }
  int r;
  if (data_only) {
    RESOLVE(fdatasync);
    r = real_fdatasync(fd);
  } else {
    RESOLVE(fsync);
    r = real_fsync(fd);
  }
  int saved = errno;
  snprintf(line, sizeof(line), "%s\tfd=%d%s\n", call, fd, data_only ? "\tdata_only=1" : "");
  emit(line);
  errno = saved;
  return r;
}

int fsync(int fd) { return traced_sync(fd, 0); }
int fdatasync(int fd) { return traced_sync(fd, 1); }

int close(int fd) {
  init();
  RESOLVE(close);
  enum kind k = kind_of_fd(fd);
  if (k == K_NONE) return real_close(fd);
  char call[32];
  snprintf(call, sizeof(call), "close:%s", suffix_of(k));
  take_inject(call);
  fd_kind[fd] = K_NONE;
  int r = real_close(fd);
  int saved = errno;
  char line[128];
  snprintf(line, sizeof(line), "%s\tfd=%d\n", call, fd);
  emit(line);
  errno = saved;
  return r;
}

static int traced_rename(int olddirfd, const char *from, int newdirfd, const char *to, unsigned int flags, int which) {
  init();
  int d1 = 0, d2 = 0;
  int tracked = (olddirfd == AT_FDCWD || from[0] == '/') && (newdirfd == AT_FDCWD || to[0] == '/') &&
                (in_dir(from, &d1) || in_dir(to, &d2));
  int err = tracked ? take_inject("rename") : 0;
  int r;
  if (err) {
    r = -1;
  } else if (which == 0) {
    RESOLVE(rename);
    r = real_rename(from, to);
  } else if (which == 1) {
    RESOLVE(renameat);
    r = real_renameat(olddirfd, from, newdirfd, to);
  } else {
    RESOLVE(renameat2);
    r = real_renameat2(olddirfd, from, newdirfd, to, flags);
  }
  int saved = errno;
  if (tracked) {
    char line[8400];
    if (err) {
      snprintf(line, sizeof(line), "rename\tpath=%s\tto=%s\tinjected=%s\n", from, to, name_of(err));
    } else {
      snprintf(line, sizeof(line), "rename\tpath=%s\tto=%s\n", from, to);
    }
    emit(line);
  }
  if (err) {
    errno = err;
    return -1;
  }
  errno = saved;
  return r;
}

int rename(const char *from, const char *to) { return traced_rename(AT_FDCWD, from, AT_FDCWD, to, 0, 0); }
int renameat(int a, const char *from, int b, const char *to) { return traced_rename(a, from, b, to, 0, 1); }
int renameat2(int a, const char *from, int b, const char *to, unsigned int flags) {
  return traced_rename(a, from, b, to, flags, 2);
}

static int traced_unlink(int dirfd, const char *path, int flags, int which) {
  init();
  int is_dir = 0;
  int tracked = (dirfd == AT_FDCWD || path[0] == '/') && !(flags & AT_REMOVEDIR) && in_dir(path, &is_dir) && !is_dir;
  int err = tracked ? take_inject("unlink") : 0;
  int r;
  if (err) {
    r = -1;
  } else if (which == 0) {
    RESOLVE(unlink);
    r = real_unlink(path);
  } else {
    RESOLVE(unlinkat);
    r = real_unlinkat(dirfd, path, flags);
  }
  int saved = errno;
  if (tracked) {
    char line[4400];
    if (err) {
      snprintf(line, sizeof(line), "unlink\tpath=%s\tinjected=%s\n", path, name_of(err));
    } else {
      snprintf(line, sizeof(line), "unlink\tpath=%s\tresult=%d\n", path, r);
    }
    emit(line);
  }
  if (err) {
    errno = err;
    return -1;
  }
  errno = saved;
  return r;
}

int unlink(const char *path) { return traced_unlink(AT_FDCWD, path, 0, 0); }
int unlinkat(int dirfd, const char *path, int flags) { return traced_unlink(dirfd, path, flags, 1); }
