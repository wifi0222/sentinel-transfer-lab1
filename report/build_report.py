"""Build the final implementation report from the maintained report source."""

from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).with_name("build_report_expanded.py")), run_name="__main__")
