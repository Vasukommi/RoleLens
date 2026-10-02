"""Export recorded browser clips as shareable H.264 videos. No dataset files are exported."""

import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / "data/demo"


def main():
    executable = shutil.which("ffmpeg")
    if not executable:
        try:
            import imageio_ffmpeg
        except ImportError as error:
            raise SystemExit("Install ffmpeg or run with uv --with imageio-ffmpeg.") from error
        executable = imageio_ffmpeg.get_ffmpeg_exe()
    source = json.loads((DIRECTORY / "recording-report.json").read_text())
    names = [
        "01-bulk-intake.webm",
        "02-processed-inbox.webm",
        "03-careers-and-review.webm",
        "04-end-card.webm",
    ]
    clips = [DIRECTORY / "recording" / name for name in names]
    durations = []
    for clip in clips:
        if not clip.exists():
            raise SystemExit(f"Record all phases first. Missing: {clip.name}")
        probe = subprocess.run(
            [executable, "-hide_banner", "-i", str(clip)], capture_output=True, text=True
        )
        match = re.search(r"Duration: (\d+):(\d+):([\d.]+)", probe.stderr)
        if not match:
            raise SystemExit(f"Could not read duration: {clip.name}")
        hours, minutes, seconds = map(float, match.groups())
        durations.append(hours * 3600 + minutes * 60 + seconds)
    output = DIRECTORY / "share"
    output.mkdir(exist_ok=True)
    inputs = [argument for clip in clips for argument in ["-i", str(clip)]]
    options = [
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        "-movflags",
        "+faststart",
    ]
    full = output / "rolelens-demo.mp4"
    subprocess.run(
        [
            executable,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            *inputs,
            "-filter_complex",
            "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[out]",
            "-map",
            "[out]",
            *options,
            str(full),
        ],
        check=True,
    )
    # The short version keeps real workflow footage; it does not accelerate processing.
    segments = [
        (0, 0, 4.5),
        (0, max(4.5, durations[0] - 8), durations[0]),
        (1, 0, min(8, durations[1])),
        (2, 0, min(10, durations[2])),
        (2, max(10, durations[2] - 18), durations[2]),
        (3, 0, durations[3]),
    ]
    filters = [
        f"[{index}:v]trim=start={start}:end={end},setpts=PTS-STARTPTS[s{number}]"
        for number, (index, start, end) in enumerate(segments)
    ]
    filters.append("".join(f"[s{i}]" for i in range(len(segments))) + "concat=n=6:v=1:a=0[out]")
    short = output / "rolelens-demo-short.mp4"
    subprocess.run(
        [
            executable,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            *inputs,
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[out]",
            *options,
            str(short),
        ],
        check=True,
    )
    subprocess.run(
        [
            executable,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(full),
            "-ss",
            "1",
            "-frames:v",
            "1",
            str(output / "cover.png"),
        ],
        check=True,
    )
    report = {
        "selected_pdfs": source["selected"],
        "actual_processing_statuses": source["bulk_summary"]["statuses"],
        "full_duration_seconds": round(sum(durations), 1),
        "short_duration_seconds": round(sum(end - start for _, start, end in segments), 1),
        "dimensions": "1440x900",
        "audio": "none; on-screen captions",
        "editing": "Clips joined; background processing wait omitted and labeled.",
        "dataset_visibility": "Aliases and counts only; close-up resume is fictional.",
        "model": source["fictional_assessment"]["model"],
    }
    (output / "video-details.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({"directory": str(output), **report}, indent=2))


if __name__ == "__main__":
    main()
