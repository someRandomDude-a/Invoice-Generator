import os
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch
from .desktop import watch_parent


class ParentWatchTests(unittest.TestCase):
    def test_parent_exit_stops_the_runner(self):
        with patch("backend.desktop.wait_for_parent_exit"), patch("backend.desktop.os._exit") as exit_process:
            watch_parent(123)
            exit_process.assert_called_once_with(0)

    def test_stdin_introspection_is_not_blocked_while_parent_is_alive(self):
        # The original stdin read held a Windows descriptor lock during dependency imports.
        code = """
import os, sys, threading, importlib.util
from backend.desktop import watch_parent
threading.Thread(target=watch_parent, args=(os.getppid(),), daemon=True).start()
sys.stdin.isatty()
if importlib.util.find_spec('torch'):
    import torch
print('ready', flush=True)
"""
        child = subprocess.Popen([sys.executable, "-c", code], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            ready = threading.Event()
            lines = []
            def read_output():
                lines.append(child.stdout.readline())
                ready.set()
            threading.Thread(target=read_output, daemon=True).start()
            self.assertTrue(ready.wait(15), "dependency imports were blocked by the parent watcher")
            self.assertEqual(lines[0].strip(), b"ready")
            self.assertEqual(child.wait(timeout=5), 0)
        finally:
            if child.poll() is None:
                child.kill(); child.wait()
            for pipe in (child.stdin, child.stdout, child.stderr):
                if pipe and not pipe.closed:
                    pipe.close()

    def test_runner_exits_after_host_termination(self):
        child_code = """
import os, threading
from backend.desktop import watch_parent
threading.Thread(target=watch_parent, args=(int(os.environ['INVOICE_PARENT_PID']),), daemon=True).start()
threading.Event().wait(60)
"""
        parent_code = f"""
import os, subprocess, sys
child = subprocess.Popen([sys.executable, '-c', {child_code!r}], env={{**os.environ, 'INVOICE_PARENT_PID': str(os.getpid())}})
print(child.pid, flush=True)
sys.stdin.read()
"""
        host = subprocess.Popen([sys.executable, "-c", parent_code], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        runner_pid = int(host.stdout.readline())
        exited = threading.Event()
        threading.Thread(target=lambda: (host.stdout.read(), exited.set()), daemon=True).start()
        try:
            # The runner also inherits stdout: EOF occurs only after both host and runner exit.
            host.stdin.close()
            self.assertEqual(host.wait(timeout=5), 0)
            self.assertTrue(exited.wait(10), "Runner survived its desktop host")
        finally:
            if not exited.is_set():
                import signal
                try: os.kill(runner_pid, signal.SIGTERM)
                except ProcessLookupError: pass
            if host.poll() is None:
                host.kill(); host.wait()
            exited.wait(5)
            for pipe in (host.stdin, host.stdout, host.stderr):
                if pipe and not pipe.closed:
                    pipe.close()


if __name__ == "__main__":
    unittest.main()
