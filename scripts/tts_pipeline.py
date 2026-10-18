#!/usr/bin/env python3

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


class ConfigError(RuntimeError):
    pass


def load_private_env() -> None:
    project_root = Path(__file__).resolve().parent.parent
    env_file = Path(
        os.environ.get(
            "BMO_TTS_ENV_FILE",
            project_root / ".private/tts.env",
        )
    ).expanduser()

    if not env_file.is_file():
        raise ConfigError(f"No encuentro la configuración privada TTS: {env_file}")

    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()

        if not line or line.startswith("#"):
            continue

        if line.startswith("export "):
            line = line[7:].strip()

        if "=" not in line:
            continue

        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip()

        if not name.isidentifier():
            continue

        if (
            len(value) >= 2
            and value[0] == value[-1]
            and value[0] in {"'", '"'}
        ):
            value = value[1:-1]

        value = os.path.expanduser(os.path.expandvars(value))
        os.environ.setdefault(name, value)


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigError(f"Falta la variable de entorno {name}.")
    return value


def executable(name: str) -> str:
    value = required_env(name)
    path = Path(value).expanduser()

    if path.is_file() and os.access(path, os.X_OK):
        return str(path)

    resolved = shutil.which(value)
    if resolved:
        return resolved

    raise ConfigError(f"{name} no apunta a un ejecutable válido: {value}")


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def preserve_debug_audio(
    debug_dir: Path,
    output: Path,
    f5_audio: Path,
    converted_audio: Path,
) -> None:
    debug_dir.mkdir(parents=True, exist_ok=True)
    stem = output.stem

    for source, suffix in (
        (f5_audio, "01-f5"),
        (converted_audio, "02-openvoice"),
        (output, "03-final"),
    ):
        shutil.copy2(source, debug_dir / f"{stem}-{suffix}.wav")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Project BMO local TTS pipeline"
    )
    parser.add_argument("--text", required=True)
    parser.add_argument(
        "--style",
        required=True,
        choices=("cheerful", "calm"),
    )
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--debug-dir",
        help="Optional private directory where intermediate WAV files are preserved.",
    )
    args = parser.parse_args()

    try:
        load_private_env()
        f5_python = executable("BMO_F5_PYTHON")
        openvoice_python = executable("BMO_OPENVOICE_PYTHON")
        ffmpeg = executable("BMO_FFMPEG")

        atempo = float(os.environ.get("BMO_TTS_ATEMPO", "1.05"))
        if not 0.5 <= atempo <= 2.0:
            raise ConfigError("BMO_TTS_ATEMPO debe estar entre 0.5 y 2.0.")

        script_dir = Path(__file__).resolve().parent
        f5_script = script_dir / "tts_f5.py"
        openvoice_script = script_dir / "tts_openvoice.py"

        output = Path(args.output).expanduser()
        output.parent.mkdir(parents=True, exist_ok=True)
        debug_dir = Path(args.debug_dir).expanduser() if args.debug_dir else None

        with tempfile.TemporaryDirectory(prefix="bmo-tts-") as temp:
            temp_dir = Path(temp)
            f5_audio = temp_dir / "f5.wav"
            converted_audio = temp_dir / "openvoice.wav"

            # Process 1: prosody / performance.
            run([
                f5_python,
                str(f5_script),
                "--text",
                args.text,
                "--style",
                args.style,
                "--output",
                str(f5_audio),
            ])

            # F5 has exited before OpenVoice is loaded.
            # Process 2: BMO target timbre.
            run([
                openvoice_python,
                str(openvoice_script),
                "--source",
                str(f5_audio),
                "--output",
                str(converted_audio),
            ])

            # Process 3: final approved rhythm adjustment.
            run([
                ffmpeg,
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(converted_audio),
                "-filter:a",
                f"atempo={atempo}",
                "-c:a",
                "pcm_s16le",
                str(output),
            ])

            if debug_dir is not None:
                preserve_debug_audio(
                    debug_dir,
                    output,
                    f5_audio,
                    converted_audio,
                )

        print(output)
        return 0

    except ConfigError as error:
        print(f"BMO TTS: {error}", file=sys.stderr)
        return 2

    except subprocess.CalledProcessError as error:
        print(
            f"BMO TTS: un proceso terminó con código {error.returncode}.",
            file=sys.stderr,
        )
        return error.returncode or 1


if __name__ == "__main__":
    raise SystemExit(main())
