"""PyInstaller entry point; paths, token and port are supplied by the desktop host."""
import multiprocessing
import os
import threading


def wait_for_parent_exit(parent_pid):
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x00100000, False, parent_pid)  # SYNCHRONIZE only.
        if not handle:
            error = ctypes.get_last_error()
            if error == 87:  # Parent exited before its process handle could be opened.
                return
            raise ctypes.WinError(error)
        try:
            if kernel.WaitForSingleObject(handle, 0xFFFFFFFF) != 0:
                raise ctypes.WinError(ctypes.get_last_error())
        finally:
            kernel.CloseHandle(handle)
    else:
        timer = threading.Event()
        while os.getppid() == parent_pid:
            timer.wait(0.5)


def watch_parent(parent_pid):
    # Never read stdin: even raw reads can hold the Windows CRT descriptor lock during imports.
    wait_for_parent_exit(parent_pid)
    os._exit(0)


def main():
    multiprocessing.freeze_support()
    if os.environ.get("INVOICE_PARENT_PID"):
        threading.Thread(target=watch_parent, args=(int(os.environ["INVOICE_PARENT_PID"]),), daemon=True, name="desktop-parent").start()
    import uvicorn
    from backend.server import app
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("INVOICE_SERVER_PORT", "17865")),
                log_level="info", access_log=False)


if __name__ == "__main__":
    main()
