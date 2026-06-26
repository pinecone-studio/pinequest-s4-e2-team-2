"use client";

import {
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

import { createDemoBackendSession, registerBackendUser, syncFirebaseUser } from "@/lib/backend-api";
import { firebaseAuth } from "@/lib/firebase";

// Firebase нэвтрэлт амжилттай болсны дараа backend дээр хэрэглэгчийг үүсгэх/шинэчлэх.
async function syncCurrentUser() {
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  const idToken = await user.getIdToken();
  return syncFirebaseUser(idToken);
}

export async function registerWithEmail(
  email: string,
  password: string,
  displayName?: string,
) {
  const fallbackName = email.split("@")[0];
  const registered = await registerBackendUser({
    email,
    password,
    name: displayName?.trim() || fallbackName,
  });
  const credential = await signInWithCustomToken(
    firebaseAuth,
    registered.custom_token,
  );
  const backendUser = await syncCurrentUser();
  return { firebaseUser: credential.user, backendUser };
}

export async function loginWithEmail(email: string, password: string) {
  const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
  const backendUser = await syncCurrentUser();
  return { firebaseUser: credential.user, backendUser };
}

export async function sendPasswordReset(email: string) {
  await sendPasswordResetEmail(firebaseAuth, email);
}

export async function logout() {
  await signOut(firebaseAuth);
}

// Демо/танилцуулгад зориулсан түргэн нэвтрэлт.
// Firebase Auth дээр энэ email/password-тэй хэрэглэгч урьдчилан үүсгэсэн байх ёстой.
export async function loginAsDemo() {
  const demoSession = await createDemoBackendSession();
  const credential = await signInWithCustomToken(firebaseAuth, demoSession.custom_token);
  const backendUser = await syncCurrentUser();
  return { firebaseUser: credential.user, backendUser: backendUser ?? demoSession.user };
}
