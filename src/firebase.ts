import { initializeApp } from 'firebase/app';
import { initializeFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Cloud Firestore with ignoreUndefinedProperties to prevent invalid-argument errors
export const db = initializeFirestore(
  app,
  {
    ignoreUndefinedProperties: true,
  },
  firebaseConfig.firestoreDatabaseId
);

/**
 * Validates connection to Firestore as required by Firebase skill
 */
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    const { doc, getDocFromServer } = await import('firebase/firestore');
    await getDocFromServer(doc(db, 'meadow_photos', 'connection_probe'));
    return true;
  } catch (error: any) {
    if (error?.message?.includes('the client is offline')) {
      console.warn('Firestore offline status:', error);
      return false;
    }
    // permission-denied or document not found still means connected to Firestore endpoint
    return true;
  }
}

export interface MeadowPhoto {
  id?: string;
  studentName: string;
  message?: string;
  photoDataUrl: string; // Background-removed image data URL
  originalThumbnail?: string; // Small preview of original
  createdAt: number;
  positionX?: number; // percentage (0 - 100) for positioning in the meadow
  positionY?: number; // percentage (0 - 100) for positioning in the meadow
  scale?: number; // size scale (0.5 - 1.5)
  rotation?: number; // slight tilt (-15 to 15 deg)
  isChunked?: boolean;
  totalChunks?: number;
  originalFileSize?: number;
}

// Keep single document safely below Firestore's 1MB limit (~500KB base64 string)
const DIRECT_SAVE_LIMIT = 500000;
const CHUNK_SIZE = 450000;

function stripUndefined<T extends Record<string, any>>(obj: T): Record<string, any> {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/**
 * Saves a student's meadow photo.
 * If the image data fits within standard Firestore document limits (<=500KB),
 * it is saved directly. If it is high-resolution (>500KB), it automatically chunks
 * the data across a subcollection, maintaining instant loading and ultra-high quality.
 */
export async function saveMeadowPhoto(photo: MeadowPhoto): Promise<string> {
  const { collection, addDoc, doc, setDoc } = await import('firebase/firestore');

  const photoLength = photo.photoDataUrl.length;

  if (photoLength <= DIRECT_SAVE_LIMIT) {
    // Standard direct save
    const payload = stripUndefined({
      ...photo,
      isChunked: false,
    });
    const docRef = await addDoc(collection(db, 'meadow_photos'), payload);
    return docRef.id;
  }

  // Large high-resolution photo: chunk into subcollection
  const totalChunks = Math.ceil(photoLength / CHUNK_SIZE);
  // Keep first 50KB preview in main document for instant meadow rendering
  const previewData = photo.photoDataUrl.slice(0, 50000);

  const mainPayload = stripUndefined({
    ...photo,
    photoDataUrl: previewData,
    isChunked: true,
    totalChunks,
  });

  const mainDocRef = await addDoc(collection(db, 'meadow_photos'), mainPayload);
  const photoId = mainDocRef.id;

  // Save chunks in parallel
  const chunkPromises: Promise<void>[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const chunkData = photo.photoDataUrl.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const chunkRef = doc(db, 'meadow_photos', photoId, 'photo_chunks', `chunk_${i}`);
    chunkPromises.push(
      setDoc(chunkRef, {
        index: i,
        chunkData,
      })
    );
  }

  await Promise.all(chunkPromises);
  return photoId;
}

/**
 * Retrieves the full resolution image dataUrl, assembling chunks if the photo was stored in parts.
 */
export async function fetchFullPhotoDataUrl(photo: MeadowPhoto): Promise<string> {
  if (!photo.isChunked || !photo.id) {
    return photo.photoDataUrl;
  }

  try {
    const { collection, getDocs, orderBy, query } = await import('firebase/firestore');
    const chunksRef = collection(db, 'meadow_photos', photo.id, 'photo_chunks');
    const q = query(chunksRef, orderBy('index', 'asc'));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return photo.photoDataUrl;
    }

    let assembled = '';
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data && typeof data.chunkData === 'string') {
        assembled += data.chunkData;
      }
    });

    return assembled || photo.photoDataUrl;
  } catch (error) {
    console.error('Failed to assemble full photo chunks:', error);
    return photo.photoDataUrl;
  }
}

/**
 * Deletes a photo document along with any subcollection chunks
 */
export async function deleteMeadowPhoto(photoId: string): Promise<void> {
  const { doc, deleteDoc, collection, getDocs } = await import('firebase/firestore');

  try {
    const chunksRef = collection(db, 'meadow_photos', photoId, 'photo_chunks');
    const chunksSnap = await getDocs(chunksRef);
    const deletePromises = chunksSnap.docs.map((d) => deleteDoc(d.ref));
    await Promise.all(deletePromises);
  } catch (e) {
    console.warn('Error deleting photo chunks:', e);
  }

  await deleteDoc(doc(db, 'meadow_photos', photoId));
}

/**
 * Updates a photo's position (positionX, positionY) in the meadow
 */
export async function updateMeadowPhotoPosition(
  photoId: string,
  positionX: number,
  positionY: number
): Promise<void> {
  const { doc, updateDoc } = await import('firebase/firestore');
  await updateDoc(doc(db, 'meadow_photos', photoId), {
    positionX,
    positionY,
  });
}
