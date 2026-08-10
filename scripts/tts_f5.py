#!/usr/bin/env python3

import argparse
import os
from pathlib import Path
import sys

from f5_tts.api import F5TTS


class ConfigError(RuntimeError):
    pass


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigError(f"Falta la variable de entorno {name}.")
    return value


def existing_file(name: str) -> str:
    path = Path(required_env(name)).expanduser()
    if not path.is_file():
        raise ConfigError(f"{name} no apunta a un archivo válido: {path}")
    return str(path)


def reference_for_style(style: str) -> tuple[str, str]:
    prefix = {
        "cheerful": "BMO_TTS_CHEERFUL",
        "calm": "BMO_TTS_CALM",
    }[style]

    return (
        existing_file(f"{prefix}_REF_FILE"),
        required_env(f"{prefix}_REF_TEXT"),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Project BMO local F5-TTS adapter")
    parser.add_argument("--text", required=True)
    parser.add_argument("--style", required=True, choices=("cheerful", "calm"))
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    try:
        checkpoint = existing_file("BMO_F5_CKPT")
        vocab = existing_file("BMO_F5_VOCAB")
        ref_file, ref_text = reference_for_style(args.style)

        device = os.environ.get("BMO_F5_DEVICE", "mps")
        seed = int(os.environ.get("BMO_F5_SEED", "12345"))
        speed = float(os.environ.get("BMO_F5_SPEED", "1.0"))

        output = Path(args.output).expanduser()
        output.parent.mkdir(parents=True, exist_ok=True)

        tts = F5TTS(
            model="F5TTS_Base",
            ckpt_file=checkpoint,
            vocab_file=vocab,
            device=device,
        )

        tts.infer(
            ref_file=ref_file,
            ref_text=ref_text,
            gen_text=args.text,
            speed=speed,
            seed=seed,
            file_wave=str(output),
        )

        print(output)
        return 0

    except (ConfigError, ValueError) as error:
        print(f"BMO TTS: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
