/*
 * SPDX-License-Identifier: MIT
 *
 * A deliberately small wrapper around NeoForge's stock early window.
 * It adds one background RenderElement and delegates every lifecycle method.
 */
package dev.y100d.loading;

import static org.lwjgl.glfw.GLFW.glfwMakeContextCurrent;
import static org.lwjgl.glfw.GLFW.glfwSetWindowIcon;
import static org.lwjgl.opengl.GL32C.GL_CLAMP_TO_EDGE;
import static org.lwjgl.opengl.GL32C.GL_COLOR_BUFFER_BIT;
import static org.lwjgl.opengl.GL32C.GL_ONE;
import static org.lwjgl.opengl.GL32C.GL_ONE_MINUS_SRC_ALPHA;
import static org.lwjgl.opengl.GL32C.GL_RGBA;
import static org.lwjgl.opengl.GL32C.GL_RGBA8;
import static org.lwjgl.opengl.GL32C.GL_SRC_ALPHA;
import static org.lwjgl.opengl.GL32C.GL_TEXTURE0;
import static org.lwjgl.opengl.GL32C.GL_TEXTURE_2D;
import static org.lwjgl.opengl.GL32C.GL_TEXTURE_MAG_FILTER;
import static org.lwjgl.opengl.GL32C.GL_TEXTURE_MIN_FILTER;
import static org.lwjgl.opengl.GL32C.GL_TEXTURE_WRAP_S;
import static org.lwjgl.opengl.GL32C.GL_TEXTURE_WRAP_T;
import static org.lwjgl.opengl.GL32C.GL_UNPACK_ALIGNMENT;
import static org.lwjgl.opengl.GL32C.GL_UNSIGNED_BYTE;
import static org.lwjgl.opengl.GL32C.glActiveTexture;
import static org.lwjgl.opengl.GL32C.glBindTexture;
import static org.lwjgl.opengl.GL32C.glBlendFuncSeparate;
import static org.lwjgl.opengl.GL32C.glClear;
import static org.lwjgl.opengl.GL32C.glClearColor;
import static org.lwjgl.opengl.GL32C.glDeleteTextures;
import static org.lwjgl.opengl.GL32C.glGenTextures;
import static org.lwjgl.opengl.GL32C.glGetInteger;
import static org.lwjgl.opengl.GL32C.glPixelStorei;
import static org.lwjgl.opengl.GL32C.glTexImage2D;
import static org.lwjgl.opengl.GL32C.glTexParameteri;

import java.io.IOException;
import java.io.InputStream;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.ByteBuffer;
import java.nio.IntBuffer;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.IntConsumer;
import java.util.function.IntSupplier;
import java.util.function.LongSupplier;
import java.util.function.Supplier;
import net.neoforged.fml.earlydisplay.DisplayWindow;
import net.neoforged.fml.earlydisplay.EarlyFramebuffer;
import net.neoforged.fml.earlydisplay.ElementShader;
import net.neoforged.fml.earlydisplay.QuadHelper;
import net.neoforged.fml.earlydisplay.RenderElement;
import net.neoforged.fml.earlydisplay.SimpleBufferBuilder;
import net.neoforged.neoforgespi.earlywindow.ImmediateWindowProvider;
import org.lwjgl.glfw.GLFWImage;
import org.lwjgl.stb.STBImage;
import org.lwjgl.system.MemoryStack;
import org.lwjgl.system.MemoryUtil;

/**
 * Keeps NeoForge's exact early-window UI and inserts a low-cost animated
 * background behind it. Reflection is isolated to the one list insertion and
 * fails open: if the expected FML 4.0.42 internals are unavailable, the stock
 * NeoForge early window continues unchanged.
 */
public final class Y100DAnimatedWindowProvider implements ImmediateWindowProvider {
    private static final String PROVIDER_NAME = "y100danimated";
    private static final String ATLAS_RESOURCE = "/y100d_loading_atlas.png";
    private static final String ICON_RESOURCE_DIRECTORY = "/y100d_icons/";
    private static final int[] ICON_SIZES = {16, 32, 48, 128, 256};
    private static final String COVER_FRAMEBUFFER_RESOURCE =
            "/META-INF/y100d/Y100DCoverFramebuffer.bin";
    private static final int ATLAS_WIDTH = 427;
    private static final int FRAME_HEIGHT = 240;
    private static final int FRAME_COUNT = 6;
    private static final int TICKS_PER_FRAME = 5; // 20 Hz loader / 5 = 250 ms
    private static final int TEXTURE_UNIT = 10;
    private static final int[] PLAYBACK = {0, 1, 2, 3, 4, 5, 4, 3, 2, 1};

    private final DisplayWindow delegate = new DisplayWindow();
    private final AtomicReference<RenderElement> backgroundElement = new AtomicReference<>();
    private final AtomicInteger textureId = new AtomicInteger();
    private final AtomicInteger currentAtlasFrame = new AtomicInteger();
    private final AtomicBoolean backgroundActive = new AtomicBoolean();
    private final AtomicBoolean coverCompositorActive = new AtomicBoolean();
    private final AtomicBoolean iconReadyReported = new AtomicBoolean();
    private final AtomicBoolean iconFailureReported = new AtomicBoolean();
    private volatile long windowHandle;
    private volatile List<RenderElement> elements;

    @Override
    public String name() {
        return PROVIDER_NAME;
    }

    @Override
    public Runnable initialize(final String[] arguments) {
        final Runnable stockTick = delegate.initialize(arguments);
        captureEarlyWindowAndApplyIcon();
        scheduleBackgroundInjection();
        return stockTick;
    }

    private void captureEarlyWindowAndApplyIcon() {
        try {
            final long window = accessibleField("window").getLong(delegate);
            windowHandle = window;
            applyWindowIcon(window);
        } catch (Throwable failure) {
            reportIconFailure(failure);
        }
    }

    private void scheduleBackgroundInjection() {
        try {
            final Field schedulerField = accessibleField("renderScheduler");
            final Field windowField = accessibleField("window");
            final Field elementsField = accessibleField("elements");
            final Field framebufferField = accessibleField("framebuffer");
            final Field contextField = accessibleField("context");
            final Object schedulerValue = schedulerField.get(delegate);
            if (!(schedulerValue instanceof ScheduledExecutorService scheduler)) {
                throw new IllegalStateException("Unexpected NeoForge render scheduler");
            }

            // DisplayWindow queues initRender at 1 ms on this same single thread.
            // Our 2 ms task therefore runs after GL/UI initialization and before
            // the first render tick, even when initRender itself takes longer.
            scheduler.schedule(
                    () -> injectBackground(
                            windowField,
                            elementsField,
                            framebufferField,
                            contextField),
                    2,
                    TimeUnit.MILLISECONDS);
        } catch (Throwable failure) {
            reportDisabled(failure);
        }
    }

    private static Field accessibleField(final String name) throws ReflectiveOperationException {
        final Field field = DisplayWindow.class.getDeclaredField(name);
        if (!field.trySetAccessible()) {
            throw new IllegalAccessException("Cannot access DisplayWindow." + name);
        }
        return field;
    }

    @SuppressWarnings("unchecked")
    private void injectBackground(
            final Field windowField,
            final Field elementsField,
            final Field framebufferField,
            final Field contextField) {
        int uploadedTexture = 0;
        try {
            final long window = windowField.getLong(delegate);
            final Object listValue = elementsField.get(delegate);
            if (!(listValue instanceof List<?>)) {
                throw new IllegalStateException("NeoForge render elements are not ready");
            }
            this.elements = (List<RenderElement>) listValue;

            glfwMakeContextCurrent(window);
            uploadedTexture = uploadAtlasTexture();
            textureId.set(uploadedTexture);

            final boolean compositorReady = installCoverFramebuffer(
                    framebufferField,
                    contextField,
                    uploadedTexture);
            coverCompositorActive.set(compositorReady);

            final RenderElement element = createBackgroundElement();
            backgroundElement.set(element);
            backgroundActive.set(true);
            elements.add(0, element);
            System.out.println(
                    "[Y100D Early Loading] Animated background ready "
                            + (compositorReady ? "(responsive cover, " : "(contained fallback, ")
                            + "6 frames, 2.5 s loop)");
        } catch (Throwable failure) {
            if (uploadedTexture != 0) {
                glDeleteTextures(uploadedTexture);
            }
            textureId.set(0);
            backgroundActive.set(false);
            coverCompositorActive.set(false);
            reportDisabled(failure);
        } finally {
            glfwMakeContextCurrent(0);
        }
    }

    private boolean installCoverFramebuffer(
            final Field framebufferField,
            final Field contextField,
            final int atlasTexture) {
        EarlyFramebuffer replacement = null;
        try {
            final Object contextValue = contextField.get(delegate);
            if (!(contextValue instanceof RenderElement.DisplayContext context)) {
                throw new IllegalStateException("NeoForge display context is not ready");
            }

            final byte[] framebufferBytes;
            try (InputStream input = Y100DAnimatedWindowProvider.class.getResourceAsStream(
                    COVER_FRAMEBUFFER_RESOURCE)) {
                if (input == null) {
                    throw new IOException("Missing " + COVER_FRAMEBUFFER_RESOURCE);
                }
                framebufferBytes = input.readAllBytes();
            }

            final MethodHandles.Lookup fmlLookup = MethodHandles.privateLookupIn(
                    EarlyFramebuffer.class,
                    MethodHandles.lookup());
            Class<?> framebufferClass;
            try {
                // Define directly into fml_earlydisplay's existing package.
                // The bytes live as a .bin resource, so our own module never
                // declares a split package during resolution.
                framebufferClass = fmlLookup.defineClass(framebufferBytes);
            } catch (LinkageError alreadyDefined) {
                framebufferClass = Class.forName(
                        "net.neoforged.fml.earlydisplay.Y100DCoverFramebuffer",
                        false,
                        EarlyFramebuffer.class.getClassLoader());
            }
            final Object instance = fmlLookup.findConstructor(
                            framebufferClass,
                            MethodType.methodType(
                                    void.class,
                                    RenderElement.DisplayContext.class,
                                    int.class,
                                    IntSupplier.class,
                                    AtomicBoolean.class,
                                    BooleanSupplier.class))
                    .invoke(
                            context,
                            atlasTexture,
                            (IntSupplier) currentAtlasFrame::get,
                            coverCompositorActive,
                            (BooleanSupplier) backgroundActive::get);
            if (!(instance instanceof EarlyFramebuffer responsiveFramebuffer)) {
                throw new IllegalStateException("Hidden compositor has an unexpected type");
            }
            replacement = responsiveFramebuffer;

            final Object previousValue = framebufferField.get(delegate);
            if (!(previousValue instanceof EarlyFramebuffer previousFramebuffer)) {
                throw new IllegalStateException("NeoForge framebuffer is not ready");
            }

            framebufferField.set(delegate, replacement);
            replacement = null;
            try {
                previousFramebuffer.close();
            } catch (Throwable closeFailure) {
                System.err.println(
                        "[Y100D Early Loading] Old framebuffer cleanup failed: "
                                + closeFailure);
            }
            return true;
        } catch (Throwable failure) {
            if (replacement != null) {
                try {
                    replacement.close();
                } catch (Throwable ignored) {
                    // The stock framebuffer is still installed and usable.
                }
            }
            System.err.println(
                    "[Y100D Early Loading] Responsive cover unavailable; "
                            + "the animated background will use NeoForge's contained path: "
                            + failure);
            return false;
        }
    }

    private RenderElement createBackgroundElement() throws ReflectiveOperationException {
        final ClassLoader loader = RenderElement.class.getClassLoader();
        final Class<?> rendererType = Class.forName(
                "net.neoforged.fml.earlydisplay.RenderElement$Renderer", true, loader);
        final Class<?> initializerType = Class.forName(
                "net.neoforged.fml.earlydisplay.RenderElement$Initializer", true, loader);

        final Object renderer = Proxy.newProxyInstance(
                loader,
                new Class<?>[] {rendererType},
                this::invokeRenderer);
        final Object initializer = Proxy.newProxyInstance(
                loader,
                new Class<?>[] {initializerType},
                (proxy, method, args) -> {
                    if (method.getName().equals("get") && method.getParameterCount() == 0) {
                        return renderer;
                    }
                    return invokeUtilityMethod(proxy, method, args);
                });

        final Constructor<RenderElement> constructor = RenderElement.class.getDeclaredConstructor(initializerType);
        if (!constructor.trySetAccessible()) {
            throw new IllegalAccessException("Cannot create the NeoForge background element");
        }
        return constructor.newInstance(initializer);
    }

    private Object invokeRenderer(final Object proxy, final Method method, final Object[] args) throws Throwable {
        if (method.getName().equals("accept") && method.getParameterCount() == 3) {
            try {
                renderBackground(
                        (SimpleBufferBuilder) args[0],
                        (RenderElement.DisplayContext) args[1],
                        (Integer) args[2]);
            } catch (Throwable failure) {
                disableBackground(failure);
            }
            return null;
        }
        return invokeUtilityMethod(proxy, method, args);
    }

    private static Object invokeUtilityMethod(
            final Object proxy, final Method method, final Object[] args) throws Throwable {
        if (method.isDefault()) {
            return InvocationHandler.invokeDefault(proxy, method, args);
        }
        if (method.getDeclaringClass() == Object.class) {
            return switch (method.getName()) {
                case "toString" -> "Y100D early-loading renderer";
                case "hashCode" -> System.identityHashCode(proxy);
                case "equals" -> proxy == args[0];
                default -> throw new UnsupportedOperationException(method.toString());
            };
        }
        throw new UnsupportedOperationException(method.toString());
    }

    private void renderBackground(
            final SimpleBufferBuilder buffer,
            final RenderElement.DisplayContext context,
            final int loaderFrame) {
        if (!backgroundActive.get()) {
            return;
        }

        final RenderElement self = backgroundElement.get();
        final List<RenderElement> currentElements = elements;
        if (self == null
                || currentElements == null
                || currentElements.isEmpty()
                || currentElements.get(0) != self) {
            // NeoForge has inserted its Mojang transition at index zero. Stop
            // drawing immediately so it remains visible, and release our only
            // GPU allocation before the main menu appears.
            releaseTexture();
            backgroundActive.set(false);
            return;
        }

        final int playbackIndex = Math.floorMod(loaderFrame / TICKS_PER_FRAME, PLAYBACK.length);
        final int atlasFrame = PLAYBACK[playbackIndex];
        currentAtlasFrame.set(atlasFrame);

        if (coverCompositorActive.get()) {
            // Turn the fixed FML framebuffer into a transparent UI layer. RGB
            // uses stock straight-alpha blending while alpha itself is kept
            // correct, producing premultiplied pixels for the final composite.
            glClearColor(0.0f, 0.0f, 0.0f, 0.0f);
            glClear(GL_COLOR_BUFFER_BIT);
            glBlendFuncSeparate(
                    GL_SRC_ALPHA,
                    GL_ONE_MINUS_SRC_ALPHA,
                    GL_ONE,
                    GL_ONE_MINUS_SRC_ALPHA);
            return;
        }

        final float v0 = atlasFrame / (float) FRAME_COUNT;
        final float v1 = (atlasFrame + 1) / (float) FRAME_COUNT;

        glActiveTexture(GL_TEXTURE0 + TEXTURE_UNIT);
        glBindTexture(GL_TEXTURE_2D, textureId.get());
        try {
            context.elementShader().updateTextureUniform(TEXTURE_UNIT);
            context.elementShader().updateRenderTypeUniform(ElementShader.RenderType.TEXTURE);
            buffer.begin(SimpleBufferBuilder.Format.POS_TEX_COLOR, SimpleBufferBuilder.Mode.QUADS);
            QuadHelper.loadQuad(
                    buffer,
                    0,
                    context.scaledWidth(),
                    0,
                    context.scaledHeight(),
                    0,
                    1,
                    v0,
                    v1,
                    0xFFFFFFFF);
            buffer.draw();
        } finally {
            glBindTexture(GL_TEXTURE_2D, 0);
            glActiveTexture(GL_TEXTURE0);
        }
    }

    private static int uploadAtlasTexture() throws IOException {
        final byte[] encodedBytes;
        try (InputStream input = Y100DAnimatedWindowProvider.class.getResourceAsStream(ATLAS_RESOURCE)) {
            if (input == null) {
                throw new IOException("Missing " + ATLAS_RESOURCE);
            }
            encodedBytes = input.readAllBytes();
        }

        final ByteBuffer encoded = MemoryUtil.memAlloc(encodedBytes.length);
        ByteBuffer decoded = null;
        int createdTexture = 0;
        int previousUnpackAlignment = 4;
        boolean unpackAlignmentCaptured = false;
        try {
            encoded.put(encodedBytes).flip();
            try (MemoryStack stack = MemoryStack.stackPush()) {
                final IntBuffer width = stack.mallocInt(1);
                final IntBuffer height = stack.mallocInt(1);
                final IntBuffer channels = stack.mallocInt(1);
                decoded = STBImage.stbi_load_from_memory(encoded, width, height, channels, 4);
                if (decoded == null) {
                    throw new IOException("Cannot decode atlas: " + STBImage.stbi_failure_reason());
                }
                if (width.get(0) != ATLAS_WIDTH || height.get(0) != FRAME_HEIGHT * FRAME_COUNT) {
                    throw new IOException(
                            "Unexpected atlas size " + width.get(0) + "x" + height.get(0));
                }

                createdTexture = glGenTextures();
                glActiveTexture(GL_TEXTURE0 + TEXTURE_UNIT);
                glBindTexture(GL_TEXTURE_2D, createdTexture);
                previousUnpackAlignment = glGetInteger(GL_UNPACK_ALIGNMENT);
                unpackAlignmentCaptured = true;
                glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, org.lwjgl.opengl.GL32C.GL_NEAREST);
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, org.lwjgl.opengl.GL32C.GL_NEAREST);
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
                glTexImage2D(
                        GL_TEXTURE_2D,
                        0,
                        GL_RGBA8,
                        width.get(0),
                        height.get(0),
                        0,
                        GL_RGBA,
                        GL_UNSIGNED_BYTE,
                        decoded);
                glActiveTexture(GL_TEXTURE0);
                return createdTexture;
            }
        } catch (Throwable failure) {
            if (createdTexture != 0) {
                glDeleteTextures(createdTexture);
            }
            if (failure instanceof IOException ioFailure) {
                throw ioFailure;
            }
            throw new IOException("Cannot upload the Y100D loading atlas", failure);
        } finally {
            if (unpackAlignmentCaptured) {
                glPixelStorei(GL_UNPACK_ALIGNMENT, previousUnpackAlignment);
            }
            glActiveTexture(GL_TEXTURE0 + TEXTURE_UNIT);
            glBindTexture(GL_TEXTURE_2D, 0);
            glActiveTexture(GL_TEXTURE0);
            if (decoded != null) {
                STBImage.stbi_image_free(decoded);
            }
            MemoryUtil.memFree(encoded);
        }
    }

    private void applyWindowIcon(final long window) throws IOException {
        if (window == 0L) {
            throw new IOException("NeoForge window handle is not ready");
        }

        final ByteBuffer[] decodedIcons = new ByteBuffer[ICON_SIZES.length];
        try (MemoryStack stack = MemoryStack.stackPush()) {
            final GLFWImage.Buffer icons = GLFWImage.malloc(ICON_SIZES.length, stack);
            for (int index = 0; index < ICON_SIZES.length; index++) {
                final int size = ICON_SIZES[index];
                final ByteBuffer pixels = decodeIcon(size);
                decodedIcons[index] = pixels;
                icons.position(index);
                icons.width(size);
                icons.height(size);
                icons.pixels(pixels);
            }

            icons.position(0);
            glfwSetWindowIcon(window, icons);
            if (iconReadyReported.compareAndSet(false, true)) {
                System.out.println(
                        "[Y100D Early Loading] Custom window icon ready "
                                + "(16/32/48/128/256 px)");
            }
        } finally {
            for (ByteBuffer decoded : decodedIcons) {
                if (decoded != null) {
                    STBImage.stbi_image_free(decoded);
                }
            }
        }
    }

    private static ByteBuffer decodeIcon(final int expectedSize) throws IOException {
        final String resource = ICON_RESOURCE_DIRECTORY
                + "icon_" + expectedSize + "x" + expectedSize + ".png";
        final byte[] encodedBytes;
        try (InputStream input = Y100DAnimatedWindowProvider.class.getResourceAsStream(resource)) {
            if (input == null) {
                throw new IOException("Missing " + resource);
            }
            encodedBytes = input.readAllBytes();
        }

        final ByteBuffer encoded = MemoryUtil.memAlloc(encodedBytes.length);
        try {
            encoded.put(encodedBytes).flip();
            try (MemoryStack stack = MemoryStack.stackPush()) {
                final IntBuffer width = stack.mallocInt(1);
                final IntBuffer height = stack.mallocInt(1);
                final IntBuffer channels = stack.mallocInt(1);
                final ByteBuffer decoded =
                        STBImage.stbi_load_from_memory(encoded, width, height, channels, 4);
                if (decoded == null) {
                    throw new IOException(
                            "Cannot decode " + resource + ": " + STBImage.stbi_failure_reason());
                }
                if (width.get(0) != expectedSize || height.get(0) != expectedSize) {
                    STBImage.stbi_image_free(decoded);
                    throw new IOException(
                            "Unexpected icon size " + width.get(0) + "x" + height.get(0)
                                    + " for " + resource);
                }
                return decoded;
            }
        } finally {
            MemoryUtil.memFree(encoded);
        }
    }

    private void disableBackground(final Throwable failure) {
        if (backgroundActive.compareAndSet(true, false)) {
            coverCompositorActive.set(false);
            releaseTexture();
            reportDisabled(failure);
        }
    }

    private void releaseTexture() {
        final int id = textureId.getAndSet(0);
        if (id != 0) {
            glDeleteTextures(id);
        }
    }

    private static void reportDisabled(final Throwable failure) {
        System.err.println(
                "[Y100D Early Loading] Custom background disabled; stock NeoForge UI remains active: "
                        + failure);
    }

    private void reportIconFailure(final Throwable failure) {
        if (iconFailureReported.compareAndSet(false, true)) {
            System.err.println(
                    "[Y100D Early Loading] Custom window icon disabled; "
                            + "the game will use its stock icon: " + failure);
        }
    }

    @Override
    public void updateFramebufferSize(final IntConsumer width, final IntConsumer height) {
        delegate.updateFramebufferSize(width, height);
    }

    @Override
    public long setupMinecraftWindow(
            final IntSupplier width,
            final IntSupplier height,
            final Supplier<String> title,
            final LongSupplier monitor) {
        final long window = delegate.setupMinecraftWindow(width, height, title, monitor);
        windowHandle = window;
        return window;
    }

    @Override
    public boolean positionWindow(
            final Optional<Object> monitor,
            final IntConsumer widthSetter,
            final IntConsumer heightSetter,
            final IntConsumer xSetter,
            final IntConsumer ySetter) {
        return delegate.positionWindow(monitor, widthSetter, heightSetter, xSetter, ySetter);
    }

    @Override
    public <T> Supplier<T> loadingOverlay(
            final Supplier<?> minecraft,
            final Supplier<?> reloadInstance,
            final Consumer<Optional<Throwable>> completion,
            final boolean fade) {
        // Minecraft applies its vanilla icon immediately after adopting the
        // early NeoForge window. This callback runs later on the same main
        // thread, so restore the pack icon once without any per-frame work.
        try {
            applyWindowIcon(windowHandle);
        } catch (Throwable failure) {
            reportIconFailure(failure);
        }
        return delegate.loadingOverlay(minecraft, reloadInstance, completion, fade);
    }

    @Override
    public void updateModuleReads(final ModuleLayer layer) {
        // Composition is intentional: DisplayWindow adds the GAME-layer read
        // edge to its own fml_earlydisplay module exactly as upstream expects.
        delegate.updateModuleReads(layer);
    }

    @Override
    public void periodicTick() {
        delegate.periodicTick();
    }

    @Override
    public String getGLVersion() {
        return delegate.getGLVersion();
    }

    @Override
    public void crash(final String message) {
        delegate.crash(message);
    }
}
