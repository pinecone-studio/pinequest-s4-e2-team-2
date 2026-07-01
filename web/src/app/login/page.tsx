"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Lock, LogIn, Mail, Sparkles } from "lucide-react";
import AuthLayout from "@/_comps/AuthLayout";
import GoogleIcon from "@/_comps/GoogleIcon";
import { Button } from "@/_comps/ui/Button";
import { Input } from "@/_comps/ui/Input";
import { Label } from "@/_comps/ui/Label";
import { signInWithGoogleAndSync } from "@/lib/google-auth";
import { loginAsDemo, loginWithEmail } from "@/lib/auth";
import { useUI } from "@/_comps/providers/UIprovider";

export default function LoginPage() {
  const router = useRouter();
  const { setAllowAccess } = useUI();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await loginWithEmail(email, password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Имэйл эсвэл нууц үг буруу байна.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError("");
    setLoading(true);
    try {
      await signInWithGoogleAndSync();
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDemoSignIn = async () => {
    setError("");
    setLoading(true);
    try {
      await loginAsDemo();
      // Demo unlock: grant access to the paid (notes/summary/AI) tabs.
      setAllowAccess(true);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Туршилтаар нэвтрэхэд алдаа гарлаа.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      icon={LogIn}
      title="Нэвтрэх"
      subtitle="Аккаунтаараа нэвтэрнэ үү"
      footer={
        <>
          Бүртгэл байхгүй юу?{" "}
          <Link href="/register" className="text-primary font-medium hover:underline">
            Бүртгүүлэх
          </Link>
        </>
      }
    >
      <Button
        variant="outline"
        className="w-full h-12 text-sm font-medium mb-6"
        onClick={handleGoogleSignIn}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <GoogleIcon className="w-5 h-5 mr-2" />
        )}
        Continue with Google
      </Button>

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-3 text-muted-foreground">or</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Имэйл</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Нууц үг</Label>
            <Link href="/forgot-password" className="text-xs text-primary hover:underline">
              Нууц үг мартсан?
            </Link>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="pl-10 pr-10 h-12"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Нууц үг нуух" : "Нууц үг харах"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <Button type="submit" className="w-full h-12 font-medium" disabled={loading || !email || !password}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Нэвтэрч байна...
            </>
          ) : (
            "Нэвтрэх"
          )}
        </Button>
      </form>

      <button
        type="button"
        onClick={handleDemoSignIn}
        disabled={loading}
        className="mt-4 w-full h-11 flex items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-muted/40 transition-colors disabled:opacity-50"
      >
        <Sparkles className="w-4 h-4" />
        Туршилтаар нэвтрэх
      </button>
    </AuthLayout>
  );
}
