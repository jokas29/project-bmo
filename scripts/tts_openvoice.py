#!/usr/bin/env python3

import argparse
import os
from pathlib import Path
import sys
import tempfile

from openvoice import se_extractor
from openvoice.api import ToneColorConverter


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


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Project BMO local OpenVoice timbre adapter"
    )
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    try:
        source = Path(args.source).expanduser()
        if not source.is_file():
            raise ConfigError(f"No existe el audio fuente: {source}")

        config = existing_file("BMO_OPENVOICE_CONFIG")
        checkpoint = existing_file("BMO_OPENVOICE_CKPT")
        target_reference = existing_file("BMO_OPENVOICE_TARGET_REF")
        source_reference = existing_file("BMO_OPENVOICE_SOURCE_REF")
        device = os.environ.get("BMO_OPENVOICE_DEVICE", "cpu")

        output = Path(args.output).expanduser()
        output.parent.mkdir(parents=True, exist_ok=True)

        converter = ToneColorConverter(config, device=device)
        converter.load_ckpt(checkpoint)

        with tempfile.TemporaryDirectory(prefix="bmo-openvoice-") as temp:
            temp_path = Path(temp)

            source_se, _ = se_extractor.get_se(
                source_reference,
                converter,
                target_dir=str(temp_path / "source"),
                vad=True,
            )

            target_se, _ = se_extractor.get_se(
                target_reference,
                converter,
                target_dir=str(temp_path / "target"),
                vad=True,
            )

            converter.convert(
                audio_src_path=str(source),
                src_se=source_se,
                tgt_se=target_se,
                output_path=str(output),
                message="@MyShell",
            )

        print(output)
        return 0

    except ConfigError as error:
        print(f"BMO TTS: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
