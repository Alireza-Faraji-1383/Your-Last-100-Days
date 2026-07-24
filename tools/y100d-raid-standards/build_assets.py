import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "kubejs/100Day/textures/raid_standards/raid_standard_base_alpha.png"
ITEM_TEXTURES = ROOT / "kubejs/assets/kubejs/textures/item"
BLOCK_TEXTURES = ROOT / "kubejs/assets/kubejs/textures/block"
ITEM_MODELS = ROOT / "kubejs/assets/kubejs/models/item"
BLOCK_MODELS = ROOT / "kubejs/assets/kubejs/models/block"
PREVIEW = ROOT / "kubejs/100Day/textures/raid_standards/raid_standards_preview.png"
DAYS = (10, 20, 30, 40, 50, 60, 70, 80, 90, 100)


def build() -> None:
    base_source = Image.open(SOURCE).convert("RGBA")
    bounds = base_source.getchannel("A").getbbox()
    if bounds is None:
        raise RuntimeError("Generated banner base is empty")

    banner = base_source.crop(bounds)
    banner.thumbnail((30, 31), Image.Resampling.NEAREST)

    ITEM_TEXTURES.mkdir(parents=True, exist_ok=True)
    BLOCK_TEXTURES.mkdir(parents=True, exist_ok=True)
    ITEM_MODELS.mkdir(parents=True, exist_ok=True)
    BLOCK_MODELS.mkdir(parents=True, exist_ok=True)
    results: list[Image.Image] = []

    for day in DAYS:
        icon_path = ITEM_TEXTURES / f"raid_icon_day{day}.png"
        icon = Image.open(icon_path).convert("RGBA")
        icon.thumbnail((18, 18), Image.Resampling.LANCZOS)

        output = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        banner_x = (32 - banner.width) // 2
        banner_y = max(0, (32 - banner.height) // 2)
        output.alpha_composite(banner, (banner_x, banner_y))

        icon_x = (32 - icon.width) // 2
        icon_y = 11
        output.alpha_composite(icon, (icon_x, icon_y))

        item_out = ITEM_TEXTURES / f"raid_standard_day{day}.png"
        output.save(item_out, optimize=True)

        # The placed standard is taller than it is wide, just like a vanilla
        # standing banner. Separate textures make the back unmistakably
        # different from the emblem-bearing front.
        block_icon = Image.open(icon_path).convert("RGBA")
        block_icon.thumbnail((28, 34), Image.Resampling.LANCZOS)

        front = Image.new("RGBA", (32, 48), (22, 19, 27, 255))
        back = Image.new("RGBA", (32, 48), (16, 14, 20, 255))

        for texture, colors in (
            (front, ((8, 7, 10, 255), (47, 42, 52, 255), (19, 17, 23, 255))),
            (back, ((7, 6, 9, 255), (34, 30, 39, 255), (14, 12, 18, 255))),
        ):
            for inset, color in enumerate(colors):
                for x in range(inset, 32 - inset):
                    texture.putpixel((x, inset), color)
                    texture.putpixel((x, 47 - inset), color)
                for y in range(inset, 48 - inset):
                    texture.putpixel((inset, y), color)
                    texture.putpixel((31 - inset, y), color)

        # Soft folds on both sides. The back additionally has a central seam
        # and visible stitching, but intentionally carries no raid emblem.
        for y in range(3, 45):
            front.putpixel((4, y), (30, 27, 35, 255))
            front.putpixel((27, y), (13, 12, 17, 255))
            back.putpixel((5, y), (25, 22, 29, 255))
            back.putpixel((26, y), (10, 9, 14, 255))
            back.putpixel((15, y), (24, 21, 29, 255))
            back.putpixel((16, y), (9, 8, 12, 255))

        for y in range(5, 44, 4):
            back.putpixel((3, y), (102, 91, 76, 255))
            back.putpixel((28, y), (102, 91, 76, 255))
            back.putpixel((15, y), (119, 104, 84, 255))

        front.alpha_composite(
            block_icon,
            ((32 - block_icon.width) // 2, (48 - block_icon.height) // 2),
        )
        front.save(
            BLOCK_TEXTURES / f"raid_standard_day{day}_front.png",
            optimize=True,
        )
        back.save(
            BLOCK_TEXTURES / f"raid_standard_day{day}_back.png",
            optimize=True,
        )
        (ITEM_MODELS / f"raid_standard_day{day}.json").write_text(
            json.dumps(
                {
                    "parent": "minecraft:item/generated",
                    "textures": {
                        "layer0": f"kubejs:item/raid_standard_day{day}"
                    },
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        (BLOCK_MODELS / f"raid_standard_day{day}.json").write_text(
            json.dumps(
                {
                    "parent": "kubejs:block/raid_standard_base",
                    "textures": {
                        "front": f"kubejs:block/raid_standard_day{day}_front",
                        "back": f"kubejs:block/raid_standard_day{day}_back",
                    },
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        results.append(output)

    # Enlarged contact sheet for quick visual QA; not referenced by the pack.
    sheet = Image.new("RGBA", (5 * 144, 2 * 144), (28, 29, 34, 255))
    for index, texture in enumerate(results):
        enlarged = texture.resize((128, 128), Image.Resampling.NEAREST)
        x = (index % 5) * 144 + 8
        y = (index // 5) * 144 + 8
        sheet.alpha_composite(enlarged, (x, y))
    sheet.save(PREVIEW, optimize=True)


if __name__ == "__main__":
    build()
