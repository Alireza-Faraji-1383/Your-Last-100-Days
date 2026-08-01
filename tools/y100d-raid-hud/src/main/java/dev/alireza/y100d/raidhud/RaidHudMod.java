package dev.alireza.y100d.raidhud;

import java.util.Set;

import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.LerpingBossEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.BossEvent;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.client.event.CustomizeGuiOverlayEvent;
import net.neoforged.neoforge.common.NeoForge;

@Mod(value = RaidHudMod.MOD_ID, dist = Dist.CLIENT)
public final class RaidHudMod {
    public static final String MOD_ID = "y100d_raid_hud";
    private static final String PERSONAL_DEATH_DATA = "[Y100D_PERSONAL_DEATHS]";

    private static final ResourceLocation FRAME = ResourceLocation.fromNamespaceAndPath(
        MOD_ID,
        "textures/gui/raid_hud_frame_wide.png"
    );
    private static final Set<String> RAID_TITLES = Set.of(
        "The Rotting Dawn",
        "Night of Bones",
        "The Bannerless Host",
        "Wrath of the Ancient Land",
        "The Arcane Covenant",
        "The Court of the Deep",
        "The Cursed Legion",
        "The Burning Siege",
        "The Dark Concord",
        "The Last Claimant"
    );

    private static final int FRAME_WIDTH = 346;
    private static final int FRAME_HEIGHT = 17;
    private static final int INNER_X = 16;
    private static final int INNER_Y = 6;
    private static final int INNER_WIDTH = 314;
    private static final int INNER_HEIGHT = 5;
    private static final int BAR_INCREMENT = 29;

    private static final BarColors PINK = new BarColors(0xFF6B1739, 0xFFE5528D);
    private static final BarColors BLUE = new BarColors(0xFF173B6B, 0xFF3B8FEA);
    private static final BarColors RED = new BarColors(0xFF671717, 0xFFE23A32);
    private static final BarColors GREEN = new BarColors(0xFF18562D, 0xFF42C765);
    private static final BarColors YELLOW = new BarColors(0xFF6B5417, 0xFFECC94B);
    private static final BarColors PURPLE = new BarColors(0xFF442065, 0xFFA45AE2);
    private static final BarColors WHITE = new BarColors(0xFF555A66, 0xFFE7EAF0);

    private static boolean disabled;
    private static boolean failureLogged;
    private static String cachedSourceText = "";
    private static HudLabels cachedLabels = HudLabels.EMPTY;
    private static int personalDeaths;

    public RaidHudMod() {
        NeoForge.EVENT_BUS.addListener(RaidHudMod::onBossBar);
        System.out.println("[Y100D Raid HUD] Client renderer installed.");
    }

    private static void onBossBar(CustomizeGuiOverlayEvent.BossEventProgress event) {
        // The server sends one zero-progress, player-specific data bar. Consume
        // it before the disabled check so it can never appear as a vanilla bar,
        // even if the decorative renderer has fallen back after an error.
        String plainName = event.getBossEvent().getName().getString();
        if (plainName.startsWith(PERSONAL_DEATH_DATA)) {
            int parsed = parseNonNegativeInt(
                plainName.substring(PERSONAL_DEATH_DATA.length()).trim()
            );
            if (parsed != personalDeaths) {
                personalDeaths = parsed;
                cachedSourceText = "";
            }
            event.setIncrement(0);
            event.setCanceled(true);
            return;
        }
        if (disabled) {
            return;
        }

        try {
            renderRaidBar(event);
        } catch (Throwable error) {
            // Rendering must never be able to take down the client. Since the
            // event is canceled only after a complete draw, vanilla immediately
            // remains as the fallback and this handler stays dormant.
            disabled = true;
            if (!failureLogged) {
                failureLogged = true;
                System.err.println("[Y100D Raid HUD] Custom renderer disabled; vanilla boss bar remains active.");
                error.printStackTrace();
            }
        }
    }

    private static void renderRaidBar(CustomizeGuiOverlayEvent.BossEventProgress event) {
        LerpingBossEvent boss = event.getBossEvent();
        String plainName = boss.getName().getString();
        String raidTitle = findRaidTitle(plainName);
        if (raidTitle == null) {
            return;
        }

        GuiGraphics graphics = event.getGuiGraphics();
        Font font = Minecraft.getInstance().font;
        HudLabels labels = labelsFor(font, plainName, raidTitle);

        int x = (graphics.guiWidth() - FRAME_WIDTH) / 2;
        int y = event.getY();
        int barX = x + INNER_X;
        int barY = y + INNER_Y;
        int filled = Math.round(INNER_WIDTH * clamp01(boss.getProgress()));
        BarColors colors = colorsFor(boss.getColor());

        // Fixed-cost rendering: no tick loop and no entity scan.
        graphics.fill(
            barX,
            barY,
            barX + INNER_WIDTH,
            barY + INNER_HEIGHT,
            0xE6100B12
        );
        if (filled > 0) {
            graphics.fill(barX, barY, barX + filled, barY + 2, colors.light());
            graphics.fill(barX, barY + 2, barX + filled, barY + INNER_HEIGHT, colors.dark());
            graphics.fill(
                barX,
                barY + INNER_HEIGHT - 1,
                barX + filled,
                barY + INNER_HEIGHT,
                0xAA09070B
            );
        }

        // The frame is authored at its exact on-screen size. Drawing it 1:1
        // keeps the end caps, dividers and pixel-art edges completely unstretched.
        graphics.blit(
            FRAME,
            x,
            y,
            0.0F,
            0.0F,
            FRAME_WIDTH,
            FRAME_HEIGHT,
            FRAME_WIDTH,
            FRAME_HEIGHT
        );

        int textY = y - 9;
        int titleX = (graphics.guiWidth() - labels.titleWidth()) / 2;
        graphics.drawString(font, labels.title(), titleX, textY, 0xFFFFFF, true);
        if (labels.leftWidth() > 0) {
            graphics.drawString(
                font,
                labels.left(),
                x + 2,
                textY,
                0xFFE6DDD0,
                true
            );
        }
        if (labels.rightWidth() > 0) {
            graphics.drawString(
                font,
                labels.right(),
                x + FRAME_WIDTH - labels.rightWidth() - 2,
                textY,
                0xFFFFD45A,
                true
            );
        }

        event.setIncrement(BAR_INCREMENT);
        event.setCanceled(true);
    }

    private static String findRaidTitle(String name) {
        for (String title : RAID_TITLES) {
            if (name.contains(title)) {
                return title;
            }
        }
        return null;
    }

    private static HudLabels labelsFor(Font font, String source, String raidTitle) {
        if (source.equals(cachedSourceText)) {
            return cachedLabels;
        }

        String wave = between(source, "(", ")");
        String mobs = tokenAfter(source, "⚔");
        String time = tokenAfter(source, "⌛");
        String teamDeaths = tokenAfter(source, "☠");
        if (time.isEmpty()) {
            time = tokenAfter(source, "next wave in");
        }
        if (teamDeaths.isEmpty()) {
            teamDeaths = "0";
        }

        String leftText = "";
        if (!wave.isEmpty()) {
            leftText = "W " + wave;
        }
        if (!mobs.isEmpty()) {
            leftText += (leftText.isEmpty() ? "" : "  ") + "⚔ " + mobs;
        }
        MutableComponent right = Component.empty();
        if (!time.isEmpty()) {
            right.append(Component.literal("⌛ " + time + "  ").withStyle(ChatFormatting.GOLD));
        }
        // Green skull = aggregate deaths of the whole FTB team.
        right.append(Component.literal("☠ " + teamDeaths + "  ").withStyle(ChatFormatting.GREEN));
        // Yellow skull = deaths of this client/player only.
        right.append(Component.literal("☠ " + personalDeaths).withStyle(ChatFormatting.YELLOW));

        // A breather has a countdown but no live-mob field. Use that existing
        // state to swap the center label without adding a tick or server packet.
        boolean waitingForNextWave = !time.isEmpty() && mobs.isEmpty();
        Component title = Component.literal(
            waitingForNextWave ? "NEXT WAVE INCOMING" : raidTitle
        );
        Component left = Component.literal(leftText);
        cachedSourceText = source;
        cachedLabels = new HudLabels(
            title,
            left,
            right,
            font.width(title),
            font.width(left),
            font.width(right)
        );
        return cachedLabels;
    }

    private static int parseNonNegativeInt(String value) {
        try {
            return Math.max(0, Integer.parseInt(value));
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private static String between(String source, String open, String close) {
        int start = source.indexOf(open);
        if (start < 0) {
            return "";
        }
        int end = source.indexOf(close, start + open.length());
        if (end < 0) {
            return "";
        }
        return source.substring(start + open.length(), end).trim();
    }

    private static String tokenAfter(String source, String marker) {
        int start = source.indexOf(marker);
        if (start < 0) {
            return "";
        }
        start += marker.length();
        while (start < source.length() && Character.isWhitespace(source.charAt(start))) {
            start++;
        }
        int end = start;
        while (end < source.length()) {
            char value = source.charAt(end);
            if (Character.isWhitespace(value) || value == '•') {
                break;
            }
            end++;
        }
        return source.substring(start, end).trim();
    }

    private static float clamp01(float value) {
        if (value < 0.0F) {
            return 0.0F;
        }
        if (value > 1.0F) {
            return 1.0F;
        }
        return value;
    }

    private static BarColors colorsFor(BossEvent.BossBarColor color) {
        return switch (color) {
            case PINK -> PINK;
            case BLUE -> BLUE;
            case GREEN -> GREEN;
            case YELLOW -> YELLOW;
            case PURPLE -> PURPLE;
            case WHITE -> WHITE;
            case RED -> RED;
        };
    }

    private record BarColors(int dark, int light) {
    }

    private record HudLabels(
        Component title,
        Component left,
        Component right,
        int titleWidth,
        int leftWidth,
        int rightWidth
    ) {
        private static final HudLabels EMPTY = new HudLabels(
            Component.empty(),
            Component.empty(),
            Component.empty(),
            0,
            0,
            0
        );
    }
}
