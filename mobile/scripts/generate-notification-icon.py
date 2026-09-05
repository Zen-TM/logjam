#!/usr/bin/env python3
"""Draw assets/notification-icon.png — the Android status-bar small icon.

Android uses ONLY the alpha channel of a small icon: it takes the mask, tints it
with `notification_icon_color` and discards the RGB. So the whole design lives in
the alpha, the ink is flat white, and anything that reads as detail at 512 px has
to survive being scaled to 24. That is why this is the logo reduced to two split
rings rather than the logo itself — its four concentric bands merge into a blur
at mdpi.

The shape is drawn on an oversized canvas and only then cropped to its ink and
fitted into the margin: shearing the halves past each other moves them further
than the ring radii suggest, and drawing straight into the final canvas clipped
them flat against the top and bottom edges.

Run: python3 scripts/generate-notification-icon.py  (needs Pillow)
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = 512  # source size handed to the expo-notifications plugin, which
# generates the five densities (24/36/48/72/96 px) from it
CONTENT = 22 / 24  # Android's small-icon glyph sits in 22 of the 24 dp box

N = 2048  # supersample canvas; the geometry below is written in 512-space
WORK = int(N * 1.4)  # room for the shear to land in without clipping
C = WORK / 2
SCALE = N / 512.0


def s(value: float) -> float:
    return value * SCALE


# Two rings, no heart: at 24 px a third band closes the gaps and the icon reads
# as a filled disc. Radii are outer/inner pairs in 512-space; only their ratios
# matter, since the result is cropped to its ink and rescaled at the end.
BANDS = [(s(240), s(194)), (s(150), s(104))]
CRACK_WIDTH = s(48)  # the split down the middle, at its narrowest
CRACK_LEAN = s(28)  # how far the split leans off vertical
HALF_OFFSET = int(s(30))  # vertical shear between the two halves


def build_mask() -> Image.Image:
    mask = Image.new("L", (WORK, WORK), 0)
    draw = ImageDraw.Draw(mask)
    for r_out, r_in in BANDS:
        draw.ellipse([C - r_out, C - r_out, C + r_out, C + r_out], fill=255)
        draw.ellipse([C - r_in, C - r_in, C + r_in, C + r_in], fill=0)

    # Shear the halves past each other, the way the logo's two pieces sit.
    left = mask.crop((0, 0, int(C), WORK))
    right = mask.crop((int(C), 0, WORK, WORK))
    mask = Image.new("L", (WORK, WORK), 0)
    mask.paste(left, (0, -HALF_OFFSET))
    mask.paste(right, (int(C), HALF_OFFSET))

    # Cut the split: a band that pinches just above centre, then splays.
    half = CRACK_WIDTH / 2
    ImageDraw.Draw(mask).polygon(
        [
            (C - half * 2.2 - CRACK_LEAN, -10),
            (C + half * 2.2 - CRACK_LEAN, -10),
            (C + half * 0.6 + CRACK_LEAN * 0.35, C * 0.9),
            (C + half * 2.5 + CRACK_LEAN, WORK + 10),
            (C - half * 2.5 + CRACK_LEAN, WORK + 10),
            (C - half * 0.6 + CRACK_LEAN * 0.35, C * 0.9),
        ],
        fill=0,
    )
    return mask


def fit_to_content_box(mask: Image.Image) -> Image.Image:
    """Crop to the ink and centre it in the content box, aspect preserved."""
    ink = mask.crop(mask.getbbox())
    box = round(OUT * CONTENT)
    scale = box / max(ink.size)
    ink = ink.resize(
        (max(1, round(ink.width * scale)), max(1, round(ink.height * scale))),
        Image.LANCZOS,
    )
    fitted = Image.new("L", (OUT, OUT), 0)
    fitted.paste(ink, ((OUT - ink.width) // 2, (OUT - ink.height) // 2))
    return fitted


def main() -> None:
    alpha = fit_to_content_box(build_mask())
    white = Image.new("L", (OUT, OUT), 255)
    target = Path(__file__).resolve().parent.parent / "assets" / "notification-icon.png"
    Image.merge("RGBA", (white, white, white, alpha)).save(target)
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
