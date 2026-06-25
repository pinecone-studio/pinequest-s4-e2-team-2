"use client";

import { signInWithPopup } from "firebase/auth";

import { syncFirebaseUser } from "@/lib/backend-api";
import { firebaseAuth, googleProvider } from "@/lib/firebase";

export async function signInWithGoogleAndSync() {
  const credential = await signInWithPopup(firebaseAuth, googleProvider);
  const idToken = await credential.user.getIdToken();
  const backendUser = await syncFirebaseUser(idToken);

  return {
    firebaseUser: credential.user,
    idToken,
    backendUser,
  };
}
