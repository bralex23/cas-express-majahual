/**
 * Web/Electron shim para expo-image-picker.
 * Metro redirige aquí automáticamente cuando platform === 'web'.
 * Implementa la misma API que expo-image-picker para que el código
 * existente funcione sin modificaciones.
 */

export const MediaTypeOptions = {
  Images: 'Images' as const,
  Videos: 'Videos' as const,
  All:    'All'    as const,
};

export interface PermissionResponse {
  status: 'granted' | 'denied';
  granted: boolean;
}

export interface ImagePickerAsset {
  uri: string;
}

export interface ImagePickerResult {
  canceled: boolean;
  assets: ImagePickerAsset[] | null;
}

/** Abre el file picker nativo del browser/Electron y devuelve el resultado. */
function pickFile(_capture?: string): Promise<ImagePickerResult> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = 'image/*';

    let settled = false;
    const settle = (result: ImagePickerResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { settle({ canceled: true, assets: null }); return; }
      const reader = new FileReader();
      reader.onload  = (e) => {
        const uri = e.target?.result as string;
        settle(uri ? { canceled: false, assets: [{ uri }] } : { canceled: true, assets: null });
      };
      reader.onerror = () => settle({ canceled: true, assets: null });
      reader.readAsDataURL(file);
    };

    (input as any).oncancel = () => settle({ canceled: true, assets: null });

    input.click();
  });
}

export async function requestMediaLibraryPermissionsAsync(): Promise<PermissionResponse> {
  return { status: 'granted', granted: true };
}

export async function requestCameraPermissionsAsync(): Promise<PermissionResponse> {
  return { status: 'granted', granted: true };
}

export async function launchImageLibraryAsync(_options?: any): Promise<ImagePickerResult> {
  return pickFile();
}

export async function launchCameraAsync(_options?: any): Promise<ImagePickerResult> {
  return pickFile();
}
