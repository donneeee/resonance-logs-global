from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
BETA_ROOT = REPO_ROOT.parent
PYDEPS = BETA_ROOT / "BPSR-UID-Extractors" / ".pydeps"
if PYDEPS.exists():
    sys.path.insert(0, str(PYDEPS))

from PIL import Image, ImageDraw, ImageFont  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Make contact sheets for Discord scene candidate PNGs.")
    parser.add_argument(
        "--scenes-dir",
        default=str(REPO_ROOT / "DEV_exports" / "discord-scene-asset-candidates" / "scenes"),
        help="Directory containing one subfolder per scene asset key.",
    )
    parser.add_argument(
        "--out-dir",
        default=str(REPO_ROOT / "DEV_exports" / "discord-scene-asset-candidates" / "contact-sheets"),
        help="Directory to write contact sheet PNGs.",
    )
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--thumb-width", type=int, default=320)
    parser.add_argument("--thumb-height", type=int, default=180)
    args = parser.parse_args()

    scenes_dir = Path(args.scenes_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    font = ImageFont.load_default()
    written: list[Path] = []
    for scene_dir in sorted(path for path in scenes_dir.iterdir() if path.is_dir()):
        files = sorted(scene_dir.glob("*.png"))
        if not files:
            continue
        sheet_path = out_dir / f"{scene_dir.name}.png"
        make_sheet(
            files=files,
            title=scene_dir.name,
            out_path=sheet_path,
            columns=max(1, args.columns),
            thumb_width=max(64, args.thumb_width),
            thumb_height=max(64, args.thumb_height),
            font=font,
        )
        written.append(sheet_path)

    print(f"Wrote {len(written)} contact sheets to {out_dir}")
    for path in written:
        print(path)
    return 0


def make_sheet(
    *,
    files: list[Path],
    title: str,
    out_path: Path,
    columns: int,
    thumb_width: int,
    thumb_height: int,
    font: ImageFont.ImageFont,
) -> None:
    pad = 18
    title_h = 34
    label_h = 50
    rows = math.ceil(len(files) / columns)
    width = columns * (thumb_width + pad) + pad
    height = title_h + pad + rows * (thumb_height + label_h + pad) + pad
    sheet = Image.new("RGBA", (width, height), (26, 28, 32, 255))
    draw = ImageDraw.Draw(sheet)
    draw.text((pad, 10), f"{title} ({len(files)} PNGs)", fill=(245, 245, 245, 255), font=font)

    for index, file_path in enumerate(files):
        x = pad + (index % columns) * (thumb_width + pad)
        y = title_h + pad + (index // columns) * (thumb_height + label_h + pad)
        draw.rectangle((x, y, x + thumb_width, y + thumb_height), fill=(8, 10, 14, 255))
        with Image.open(file_path) as src:
            image = src.convert("RGBA")
            original_size = image.size
            image.thumbnail((thumb_width, thumb_height), Image.Resampling.LANCZOS)
            sheet.alpha_composite(
                image,
                (x + (thumb_width - image.width) // 2, y + (thumb_height - image.height) // 2),
            )

        label = file_path.stem[:44]
        size_label = f"{original_size[0]}x{original_size[1]}"
        draw.text((x, y + thumb_height + 6), label, fill=(232, 232, 232, 255), font=font)
        draw.text((x, y + thumb_height + 22), size_label, fill=(160, 174, 190, 255), font=font)

    sheet.save(out_path)


if __name__ == "__main__":
    raise SystemExit(main())
