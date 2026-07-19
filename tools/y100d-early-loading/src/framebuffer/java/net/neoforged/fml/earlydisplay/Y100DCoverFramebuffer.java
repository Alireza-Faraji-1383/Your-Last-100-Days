/*
 * SPDX-License-Identifier: MIT
 *
 * Compiled as a runtime-defined payload by build.ps1. Keeping the bytecode out
 * of the normal class tree avoids a split package with fml_earlydisplay.
 */
package net.neoforged.fml.earlydisplay;

import static org.lwjgl.opengl.GL32C.GL_ARRAY_BUFFER;
import static org.lwjgl.opengl.GL32C.GL_COLOR_BUFFER_BIT;
import static org.lwjgl.opengl.GL32C.GL_DRAW_FRAMEBUFFER;
import static org.lwjgl.opengl.GL32C.GL_FRAMEBUFFER;
import static org.lwjgl.opengl.GL32C.GL_FRAMEBUFFER_BINDING;
import static org.lwjgl.opengl.GL32C.GL_NEAREST;
import static org.lwjgl.opengl.GL32C.GL_ONE;
import static org.lwjgl.opengl.GL32C.GL_ONE_MINUS_SRC_ALPHA;
import static org.lwjgl.opengl.GL32C.GL_READ_FRAMEBUFFER;
import static org.lwjgl.opengl.GL32C.GL_SRC_ALPHA;
import static org.lwjgl.opengl.GL32C.GL_TEXTURE0;
import static org.lwjgl.opengl.GL32C.GL_TEXTURE_2D;
import static org.lwjgl.opengl.GL32C.glActiveTexture;
import static org.lwjgl.opengl.GL32C.glBindBuffer;
import static org.lwjgl.opengl.GL32C.glBindFramebuffer;
import static org.lwjgl.opengl.GL32C.glBindTexture;
import static org.lwjgl.opengl.GL32C.glBindVertexArray;
import static org.lwjgl.opengl.GL32C.glBlendFunc;
import static org.lwjgl.opengl.GL32C.glBlitFramebuffer;
import static org.lwjgl.opengl.GL32C.glClear;
import static org.lwjgl.opengl.GL32C.glClearColor;
import static org.lwjgl.opengl.GL32C.glEnable;
import static org.lwjgl.opengl.GL32C.glGetInteger;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import java.util.function.IntSupplier;

/**
 * Final-window compositor for FML earlydisplay 4.0.42.
 *
 * <p>The animated art uses cover scaling against the real framebuffer. The
 * fixed 854x480 FML UI texture is then alpha-composited at contain scale, so
 * labels, bars, logs and the fox keep their stock proportions.</p>
 */
final class Y100DCoverFramebuffer extends EarlyFramebuffer {
    private static final int ATLAS_WIDTH = 427;
    private static final int FRAME_HEIGHT = 240;
    private static final int FRAME_COUNT = 6;
    private static final int ATLAS_TEXTURE_UNIT = 10;
    private static final int UI_TEXTURE_UNIT = 11;

    private final RenderElement.DisplayContext context;
    private final int atlasTexture;
    private final IntSupplier atlasFrame;
    private final AtomicBoolean coverMode;
    private final BooleanSupplier backgroundActive;
    private final SimpleBufferBuilder buffer = new SimpleBufferBuilder(256);
    private final int[] containedBounds = new int[4];
    private int sourceFramebuffer;
    private boolean failureReported;

    Y100DCoverFramebuffer(
            final RenderElement.DisplayContext context,
            final int atlasTexture,
            final IntSupplier atlasFrame,
            final AtomicBoolean coverMode,
            final BooleanSupplier backgroundActive) {
        super(context);
        this.context = context;
        this.atlasTexture = atlasTexture;
        this.atlasFrame = atlasFrame;
        this.coverMode = coverMode;
        this.backgroundActive = backgroundActive;
    }

    @Override
    void activate() {
        super.activate();
        if (sourceFramebuffer == 0) {
            // One readback on the first frame only. EarlyFramebuffer keeps the
            // same FBO for its entire lifetime.
            sourceFramebuffer = glGetInteger(GL_FRAMEBUFFER_BINDING);
        }
    }

    @Override
    void draw(final int windowWidth, final int windowHeight) {
        if (windowWidth <= 0 || windowHeight <= 0 || sourceFramebuffer == 0) {
            restoreKnownEarlyWindowState();
            return;
        }

        if (coverMode.get() && backgroundActive.getAsBoolean()) {
            try {
                drawCoverAndContainedUi(windowWidth, windowHeight);
                return;
            } catch (Throwable failure) {
                coverMode.set(false);
                if (!failureReported) {
                    failureReported = true;
                    System.err.println(
                            "[Y100D Early Loading] Responsive cover disabled; "
                                    + "using a contained dark fallback: "
                                    + failure);
                }
            }
        }

        try {
            drawContainedFallback(windowWidth, windowHeight);
        } finally {
            restoreKnownEarlyWindowState();
        }
    }

    private void drawCoverAndContainedUi(final int windowWidth, final int windowHeight) {
        final ElementShader shader = context.elementShader();
        try {
            glBindFramebuffer(GL_FRAMEBUFFER, 0);
            glEnable(org.lwjgl.opengl.GL32C.GL_BLEND);
            shader.activate();
            shader.updateScreenSizeUniform(windowWidth, windowHeight);
            shader.updateRenderTypeUniform(ElementShader.RenderType.TEXTURE);

            drawAtlasCover(shader, windowWidth, windowHeight);
            drawContainedUi(shader, windowWidth, windowHeight);
        } finally {
            try {
                shader.clear();
            } finally {
                restoreKnownEarlyWindowState();
            }
        }
    }

    private void drawAtlasCover(
            final ElementShader shader, final int windowWidth, final int windowHeight) {
        final int frame = Math.floorMod(atlasFrame.getAsInt(), FRAME_COUNT);
        final float frameV = 1.0f / FRAME_COUNT;
        float u0 = 0.0f;
        float u1 = 1.0f;
        float v0 = frame * frameV;
        float v1 = v0 + frameV;

        final float sourceAspect = ATLAS_WIDTH / (float) FRAME_HEIGHT;
        final float targetAspect = windowWidth / (float) windowHeight;
        if (targetAspect > sourceAspect) {
            final float visibleHeight = sourceAspect / targetAspect;
            final float crop = (1.0f - visibleHeight) * frameV * 0.5f;
            v0 += crop;
            v1 -= crop;
        } else if (targetAspect < sourceAspect) {
            final float visibleWidth = targetAspect / sourceAspect;
            final float crop = (1.0f - visibleWidth) * 0.5f;
            u0 += crop;
            u1 -= crop;
        }

        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
        glActiveTexture(GL_TEXTURE0 + ATLAS_TEXTURE_UNIT);
        glBindTexture(GL_TEXTURE_2D, atlasTexture);
        shader.updateTextureUniform(ATLAS_TEXTURE_UNIT);
        buffer.begin(SimpleBufferBuilder.Format.POS_TEX_COLOR, SimpleBufferBuilder.Mode.QUADS);
        QuadHelper.loadQuad(
                buffer,
                0,
                windowWidth,
                0,
                windowHeight,
                u0,
                u1,
                v1,
                v0,
                0xFFFFFFFF);
        buffer.draw();
    }

    private void drawContainedUi(
            final ElementShader shader, final int windowWidth, final int windowHeight) {
        updateContainedBounds(windowWidth, windowHeight);

        // The stock UI was blended into a transparent FBO with correct alpha,
        // so its RGB is premultiplied. This blend preserves antialiased glyphs.
        glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
        glActiveTexture(GL_TEXTURE0 + UI_TEXTURE_UNIT);
        glBindTexture(GL_TEXTURE_2D, getTexture());
        shader.updateTextureUniform(UI_TEXTURE_UNIT);
        buffer.begin(SimpleBufferBuilder.Format.POS_TEX_COLOR, SimpleBufferBuilder.Mode.QUADS);
        QuadHelper.loadQuad(
                buffer,
                containedBounds[0],
                containedBounds[2],
                containedBounds[1],
                containedBounds[3],
                0,
                1,
                1,
                0,
                0xFFFFFFFF);
        buffer.draw();
    }

    private void drawContainedFallback(final int windowWidth, final int windowHeight) {
        final int sourceWidth = context.scaledWidth();
        final int sourceHeight = context.scaledHeight();
        updateContainedBounds(windowWidth, windowHeight);

        glBindFramebuffer(GL_DRAW_FRAMEBUFFER, 0);
        glBindFramebuffer(GL_READ_FRAMEBUFFER, sourceFramebuffer);
        glClearColor(0.004f, 0.003f, 0.009f, 1.0f);
        glClear(GL_COLOR_BUFFER_BIT);
        glBlitFramebuffer(
                0,
                sourceHeight,
                sourceWidth,
                0,
                containedBounds[0],
                containedBounds[1],
                containedBounds[2],
                containedBounds[3],
                GL_COLOR_BUFFER_BIT,
                GL_NEAREST);
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
    }

    private void updateContainedBounds(final int windowWidth, final int windowHeight) {
        // This intentionally mirrors FML 4.0.42 EarlyFramebuffer.draw(): it
        // scales from logical dimensions, includes FBScale, truncates each edge
        // independently, and clamps to the real framebuffer.
        final float widthScale = windowWidth / (float) context.width();
        final float heightScale = windowHeight / (float) context.height();
        final float halfScale = context.scale() * Math.min(widthScale, heightScale) * 0.5f;
        containedBounds[0] = clamp((int) (windowWidth * 0.5f - halfScale * context.width()), 0, windowWidth);
        containedBounds[1] = clamp((int) (windowHeight * 0.5f - halfScale * context.height()), 0, windowHeight);
        containedBounds[2] = clamp((int) (windowWidth * 0.5f + halfScale * context.width()), 0, windowWidth);
        containedBounds[3] = clamp((int) (windowHeight * 0.5f + halfScale * context.height()), 0, windowHeight);
    }

    private static int clamp(final int value, final int minimum, final int maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    private void restoreKnownEarlyWindowState() {
        glActiveTexture(GL_TEXTURE0 + ATLAS_TEXTURE_UNIT);
        glBindTexture(GL_TEXTURE_2D, 0);
        glActiveTexture(GL_TEXTURE0 + UI_TEXTURE_UNIT);
        glBindTexture(GL_TEXTURE_2D, 0);
        glActiveTexture(GL_TEXTURE0);
        glBindTexture(GL_TEXTURE_2D, 0);
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
        glBindBuffer(GL_ARRAY_BUFFER, 0);
        glBindVertexArray(0);
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        restoreClearColour();
    }

    private void restoreClearColour() {
        final ColourScheme.Colour background = context.colourScheme().background();
        glClearColor(
                background.redf(),
                background.greenf(),
                background.bluef(),
                1.0f);
    }

    @Override
    public void close() {
        try {
            buffer.close();
        } finally {
            super.close();
        }
    }
}
