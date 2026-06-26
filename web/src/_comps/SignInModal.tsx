"use client";

import { useState } from "react";
import { X, Mail, Lock, Eye, EyeOff, Tv2 } from "lucide-react";
import { Button } from "@/_comps/ui/Button";
import { Input } from "@/_comps/ui/Input";
import { Label } from "@/_comps/ui/Label";
import GoogleIcon from "@/_comps/GoogleIcon";
import { signInWithGoogleAndSync } from "@/lib/google-auth";
import { loginAsDemo, loginWithEmail, registerWithEmail } from "@/lib/auth";

export default function SignInModal({ onClose }: { onClose: () => void }) {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      if (mode === "signin") {
        await loginWithEmail(email, password);
      } else {
        await registerWithEmail(email, password);
      }
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Нэвтрэлт амжилтгүй боллоо",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError("");
    setIsLoading(true);
    try {
      await signInWithGoogleAndSync();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDemoSignIn = async () => {
    setError("");
    setIsLoading(true);
    try {
      await loginAsDemo();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo sign-in failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-6 duration-200">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Tv2 className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-heading font-bold text-foreground">
              HELEX
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-sm font-medium">
              Имэйл
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-sm font-medium">
              Нууц үг
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10 pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full mb-5"
            onClick={handleGoogleSignIn}
            disabled={isLoading}
          >
            <GoogleIcon className="w-5 h-5 mr-2" />
            Continue with Google
          </Button>

          <Button
            type="submit"
            className="w-full font-semibold"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Түр хүлээнэ үү...
              </span>
            ) : mode === "signin" ? (
              "Нэвтрэх"
            ) : (
              "Бүртгүүлэх"
            )}
          </Button>
        </form>

        <Button
          type="button"
          variant="ghost"
          className="w-full mt-3 text-sm text-muted-foreground"
          onClick={handleDemoSignIn}
          disabled={isLoading}
        >
          Демо-р үзэх
        </Button>

        <div className="mt-4 text-center">
          <p className="text-sm text-muted-foreground">
            {mode === "signin"
              ? "Бүртгэл байхгүй юу? "
              : "Аль хэдийн бүртгэлтэй юу? "}
            <button
              onClick={() => setMode(mode === "signin" ? "register" : "signin")}
              className="text-primary font-medium hover:underline"
            >
              {mode === "signin" ? "Бүртгүүлэх" : "Нэвтрэх"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
