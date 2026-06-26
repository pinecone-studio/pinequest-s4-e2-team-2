"use client";

import { signInWithPopup } from "firebase/auth";

import { createGuestSession, syncFirebaseUser } from "@/lib/backend-api";
import { firebaseAuth, googleProvider } from "@/lib/firebase";

export async function signInWithGoogleAndSync() {
  const credential = await signInWithPopup(firebaseAuth, googleProvider);
  const idToken = await credential.user.getIdToken();

  let backendUser;
  try {
    backendUser = await syncFirebaseUser(idToken);
  } catch (error) {
    // Backend couldn't verify the Firebase token (e.g. admin credentials
    // aren't configured yet) — fall back to a guest session so sign-in
    // still succeeds instead of failing the whole flow.
    console.warn("[auth] Backend sync failed, falling back to guest session", error);
    backendUser = await createGuestSession();
  }

  return {
    firebaseUser: credential.user,
    idToken,
    backendUser,
  };
}
