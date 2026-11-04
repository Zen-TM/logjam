import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library/legacy";

import { alertPermissionDenied } from "../permissionAlert";
import { libraryPickerOptions } from "./attachBatch";
import { savesCapturesToGallery } from "./galleryPreference";
import type { PickedFile } from "../sync/mediaUpload";
import type { Glyph } from "../ui";

/**
 * Copy a just-captured file into the phone's gallery, if the user asked for
 * that (`galleryPreference.ts`).
 *
 * WRITE-ONLY permission: nothing in Logjam GPS reads the gallery — the library
 * picker is expo-image-picker's own, with its own grant — so this asks for the
 * smallest scope that can do the job.
 *
 * Every failure is silent, deliberately, and this is the one place in the file
 * where that is right. The user's actual request (attach this photo) is about
 * to succeed either way; interrupting it with an alert about a side copy, on a
 * ledge, is worse than the copy not existing. A denial is not re-asked either —
 * expo remembers `canAskAgain`, and the switch in Settings is where someone who
 * wants this goes back to.
 *
 * PRIVACY: the file leaves app-private storage here and lands somewhere Logjam
 * GPS no longer controls. That is the whole content of the preference, and why
 * this function is never called without checking it.
 */
async function saveToGalleryIfWanted(uri: string): Promise<void> {
  if (!savesCapturesToGallery()) return;
  try {
    const existing = await MediaLibrary.getPermissionsAsync(true);
    const permission = existing.granted
      ? existing
      : await MediaLibrary.requestPermissionsAsync(true);
    if (!permission.granted) return;
    await MediaLibrary.saveToLibraryAsync(uri);
  } catch (err) {
    // No filename, no path: this is media on a place.
    console.error(
      "Gallery copy failed",
      err instanceof Error ? err.name : "unknown",
    );
  }
}

/** The sources a photo or video comes from, in the order every sheet lists
 *  them, and the words for the sheet and the entry that opens it. One list, so
 *  the place page's strip and the Add-a-place form cannot drift. */
export const ADD_PHOTO_LABEL = "Add a photo or video";
export const PHOTO_SOURCES: readonly {
  icon: Glyph;
  title: string;
  source: "camera" | "library";
  kind: "photo" | "video";
}[] = [
  { icon: "camera", title: "Take photo", source: "camera", kind: "photo" },
  { icon: "video", title: "Record video", source: "camera", kind: "video" },
  {
    icon: "photo",
    title: "Choose from library",
    source: "library",
    kind: "photo",
  },
];

/**
 * Take or choose photos and videos, as files to attach. Empty when the user
 * backed out or a permission was refused (the alert has already said so).
 *
 * Shared by the place and trip strips and the Add-a-place form, so a pick is
 * the same pick wherever it starts. A system picker can only run with no Modal
 * on screen (DESIGN.md §4): call this from a sheet's `onClosed`.
 */
export async function pickMedia(
  source: "camera" | "library",
  kind: "photo" | "video",
): Promise<PickedFile[]> {
  // NO permission call for the camera here. `launchCameraAsync` always asks
  // natively (ImagePickerModule.ensureCameraPermissionsAreGranted), so a
  // second ask from JS is redundant — and on this device that ask is exactly
  // what hangs: expo's permission request for CAMERA never invokes its
  // callback, so the promise never settles and the button appears dead.
  // Asking once, natively, is the smaller surface until that is resolved.
  if (source === "library") {
    const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
    const permission = existing.granted
      ? existing
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      alertPermissionDenied({
        title: "Photo access needed",
        askAgainMessage:
          "Allow photo library access to attach photos and videos.",
        settingsMessage:
          "Photo access was previously denied. Enable it for Logjam GPS in system settings.",
        canAskAgain: permission.canAskAgain,
      });
      return [];
    }
  }
  const mediaTypes: ImagePicker.MediaType[] =
    kind === "video"
      ? ["videos"]
      : source === "camera"
        ? ["images"]
        : ["images", "videos"];
  let result: ImagePicker.ImagePickerResult;
  try {
    result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync({ mediaTypes, quality: 1 })
        : await ImagePicker.launchImageLibraryAsync(
            libraryPickerOptions(mediaTypes),
          );
  } catch (err) {
    // launchCameraAsync REJECTS when CAMERA is denied (its own native
    // ensureCameraPermissionsAreGranted), so reading the status here
    // prevents closing the sheet without feedback. READ the status here —
    // don't ask for it, per the comment above.
    if (source === "camera") {
      const permission = await ImagePicker.getCameraPermissionsAsync();
      if (!permission.granted) {
        alertPermissionDenied({
          title: "Camera permission needed",
          askAgainMessage: "Allow camera access to take a photo here.",
          settingsMessage:
            "The camera was previously denied. Enable it for Logjam GPS in system settings.",
          canAskAgain: permission.canAskAgain,
        });
        return [];
      }
    }
    throw err;
  }
  if (result.canceled || result.assets.length === 0) return [];
  // The gallery copy happens BEFORE the attach, and its failure is never
  // allowed to cost the attachment: the photo the user actually asked for
  // is the one going onto the place, and a refused media permission must
  // not take that with it (Settings → Privacy and security).
  if (source === "camera") await saveToGalleryIfWanted(result.assets[0].uri);
  return result.assets.map((asset) => ({
    uri: asset.uri,
    mimeType: asset.mimeType,
    fileName: asset.fileName,
  }));
}
