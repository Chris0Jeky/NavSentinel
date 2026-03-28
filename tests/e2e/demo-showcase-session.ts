import { chromium, type BrowserContext, type TestInfo } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { getExtensionId, getGymBaseUrl } from "./extension_test_utils";

type DemoMode = "fast" | "live" | "record";

type DemoSettings = {
  artifactDir: string | null;
  captureTrace: boolean;
  captureVideo: boolean;
  mode: DemoMode;
  slowMo: number;
  viewport: { height: number; width: number };
};

type DemoSession = {
  baseUrl: string;
  close: () => Promise<void>;
  context: BrowserContext;
  extensionId: string;
  settings: DemoSettings;
};

function getDemoMode(): DemoMode {
  const raw = (process.env.NAVSENTINEL_DEMO_MODE ?? "live").toLowerCase();
  if (raw === "fast" || raw === "record") return raw;
  return "live";
}

function getDemoSettings(): DemoSettings {
  const mode = getDemoMode();
  const artifactDir = process.env.NAVSENTINEL_DEMO_ARTIFACT_DIR?.trim() || null;
  const captureVideo = (process.env.NAVSENTINEL_DEMO_VIDEO ?? "0") === "1";
  const captureTrace = (process.env.NAVSENTINEL_DEMO_TRACE ?? "0") === "1";

  return {
    artifactDir,
    captureTrace,
    captureVideo,
    mode,
    slowMo: mode === "record" ? 45 : 0,
    viewport: { width: 1440, height: 960 }
  };
}

export async function launchDemoSession(params: {
  extensionPath: string;
  gymRoot: string;
  testInfo: TestInfo;
}): Promise<DemoSession> {
  const { extensionPath, gymRoot, testInfo } = params;
  const settings = getDemoSettings();
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-demo-"));

  if (settings.artifactDir) {
    fs.mkdirSync(settings.artifactDir, { recursive: true });
  }

  const launchOptions = {
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    headless: false,
    slowMo: settings.slowMo,
    timeout: 60_000,
    viewport: settings.viewport
  };

  if (settings.captureVideo && settings.artifactDir) {
    Object.assign(launchOptions, {
      recordVideo: {
        dir: settings.artifactDir,
        size: settings.viewport
      }
    });
  }

  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(userDataDir, launchOptions);

    if (settings.captureTrace) {
      await context.tracing.start({
        screenshots: true,
        snapshots: true,
        title: testInfo.title
      });
    }
  } catch (error) {
    if (context) {
      await context.close().catch(() => {});
    }
    if (gym) {
      await gym.close().catch(() => {});
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }

  try {
    const extensionId = await getExtensionId(context);

    return {
      baseUrl,
      close: async () => {
        try {
          if (settings.captureTrace) {
            const tracePath = settings.artifactDir
              ? path.join(settings.artifactDir, `${slugify(testInfo.title)}.trace.zip`)
              : testInfo.outputPath("demo.trace.zip");
            fs.mkdirSync(path.dirname(tracePath), { recursive: true });
            await context.tracing.stop({ path: tracePath });
          }
        } finally {
          await context.close();
          if (gym) await gym.close();
          fs.rmSync(userDataDir, { recursive: true, force: true });
        }
      },
      context,
      extensionId,
      settings
    };
  } catch (error) {
    await context.close().catch(() => {});
    if (gym) {
      await gym.close().catch(() => {});
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
