import { invoke } from "@tauri-apps/api/core";
import {
  SETTINGS,
  normalizeSkillMonitorProfileForPersistence,
  type SkillMonitorProfile,
} from "$lib/settings-store";

type ProfileLibraryJsonFile = {
  fileName: string;
  path: string;
  content: string;
};

type ProfileLibrarySkippedFile = {
  fileName: string;
  reason: string;
};

export const profileLibraryRuntime = $state({
  loading: false,
  loadedCount: 0,
  skippedFiles: [] as ProfileLibrarySkippedFile[],
  lastError: "",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fileStem(fileName: string): string {
  return fileName.replace(/\.json$/i, "");
}

function profileFileSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "profile";
}

function nextProfileFileName(profile: SkillMonitorProfile): string {
  return `${profileFileSlug(profile.name || profile.id)}.json`;
}

function uniqueProfileId(id: string, seen: Set<string>): string {
  if (!seen.has(id)) {
    seen.add(id);
    return id;
  }
  let counter = 2;
  while (seen.has(`${id}-${counter}`)) counter += 1;
  const unique = `${id}-${counter}`;
  seen.add(unique);
  return unique;
}

function extractProfilePayloads(parsed: unknown): unknown[] {
  if (!isRecord(parsed)) return [];
  if (Array.isArray(parsed["profiles"])) return parsed["profiles"];
  if (isRecord(parsed["profile"])) return [parsed["profile"]];
  if (
    typeof parsed["name"] === "string" ||
    typeof parsed["selectedClass"] === "string" ||
    Array.isArray(parsed["monitoredSkillIds"]) ||
    Array.isArray(parsed["monitoredBuffIds"])
  ) {
    return [parsed];
  }
  return [];
}

function selectLoadedProfile(profiles: SkillMonitorProfile[], profileFiles: Record<string, string>) {
  const currentProfile =
    SETTINGS.skillMonitor.state.profiles[SETTINGS.skillMonitor.state.activeProfileIndex];
  const preferredId =
    SETTINGS.profileLibrary.state.lastSelectedProfileId || currentProfile?.id || "";
  const preferredFile = SETTINGS.profileLibrary.state.lastSelectedProfileFile;

  let index = preferredId
    ? profiles.findIndex((profile) => profile.id === preferredId)
    : -1;
  if (index < 0 && preferredFile) {
    index = profiles.findIndex((profile) => profileFiles[profile.id] === preferredFile);
  }
  if (index < 0) index = 0;

  SETTINGS.skillMonitor.state.activeProfileIndex = index;
  const selected = profiles[index];
  if (selected) {
    SETTINGS.profileLibrary.state.lastSelectedProfileId = selected.id;
    SETTINGS.profileLibrary.state.lastSelectedProfileFile = profileFiles[selected.id] ?? "";
  }
}

export async function loadProfileLibraryFromSettings(): Promise<boolean> {
  const folder = SETTINGS.profileLibrary.state.folder.trim();
  profileLibraryRuntime.lastError = "";
  profileLibraryRuntime.skippedFiles = [];
  profileLibraryRuntime.loadedCount = 0;
  if (!folder) return false;

  profileLibraryRuntime.loading = true;
  try {
    const files = await invoke<ProfileLibraryJsonFile[]>("read_profile_library_files", {
      directory: folder,
    });
    const profiles: SkillMonitorProfile[] = [];
    const profileFiles: Record<string, string> = {};
    const seenIds = new Set<string>();
    const skipped: ProfileLibrarySkippedFile[] = [];

    for (const file of files) {
      try {
        const parsed = JSON.parse(file.content) as unknown;
        const payloads = extractProfilePayloads(parsed);
        if (payloads.length === 0) {
          skipped.push({ fileName: file.fileName, reason: "No profile payload found" });
          continue;
        }

        payloads.forEach((payload, payloadIndex) => {
          const fallbackId =
            payloads.length === 1
              ? fileStem(file.fileName)
              : `${fileStem(file.fileName)}-${payloadIndex + 1}`;
          const profile = normalizeSkillMonitorProfileForPersistence(
            payload,
            profiles.length,
            { fallbackId },
          );
          profile.id = uniqueProfileId(profile.id, seenIds);
          profiles.push(profile);
          profileFiles[profile.id] = file.fileName;
        });
      } catch (error) {
        skipped.push({
          fileName: file.fileName,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    profileLibraryRuntime.skippedFiles = skipped;
    profileLibraryRuntime.loadedCount = profiles.length;
    if (profiles.length === 0) {
      return false;
    }

    SETTINGS.skillMonitor.state.profiles = profiles;
    SETTINGS.profileLibrary.state.profileFiles = profileFiles;
    selectLoadedProfile(profiles, profileFiles);
    return true;
  } catch (error) {
    profileLibraryRuntime.lastError = error instanceof Error ? error.message : String(error);
    return false;
  } finally {
    profileLibraryRuntime.loading = false;
  }
}

export async function saveActiveProfileToLibrary(): Promise<string> {
  const folder = SETTINGS.profileLibrary.state.folder.trim();
  if (!folder) throw new Error("Profile library folder is not configured");

  const profile =
    SETTINGS.skillMonitor.state.profiles[SETTINGS.skillMonitor.state.activeProfileIndex];
  if (!profile) throw new Error("No active profile is selected");

  const existingFileName = SETTINGS.profileLibrary.state.profileFiles[profile.id];
  const fileName = existingFileName || nextProfileFileName(profile);
  const content = JSON.stringify(profile);
  const path = await invoke<string>("write_profile_library_file", {
    directory: folder,
    fileName,
    content,
  });

  SETTINGS.profileLibrary.state.profileFiles = {
    ...SETTINGS.profileLibrary.state.profileFiles,
    [profile.id]: fileName,
  };
  SETTINGS.profileLibrary.state.lastSelectedProfileId = profile.id;
  SETTINGS.profileLibrary.state.lastSelectedProfileFile = fileName;
  return path;
}

export async function openProfileLibraryFolder(): Promise<void> {
  const folder = SETTINGS.profileLibrary.state.folder.trim();
  if (!folder) throw new Error("Profile library folder is not configured");
  await invoke("open_profile_library_dir", { directory: folder });
}
