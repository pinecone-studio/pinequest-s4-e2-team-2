"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Loader2,
  QrCode,
  RefreshCw,
} from "lucide-react";

import Header from "@/_comps/Header";
import SignInModal from "@/_comps/SignInModal";
import { useAuth } from "@/_comps/providers/AuthProvider";
import { ThemeProvider } from "@/_comps/providers/ThemeProvider";
import { Button } from "@/_comps/ui/Button";
import {
  createQPayPayment,
  getQPayPaymentStatus,
  type PaymentOrderRecord,
} from "@/lib/backend-api";

function qrImageSrc(qrImage: string | null): string | null {
  if (!qrImage) return null;
  if (qrImage.startsWith("data:image")) return qrImage;
  return `data:image/png;base64,${qrImage}`;
}

function money(amount: number, currency: string): string {
  return `${new Intl.NumberFormat("mn-MN").format(amount)} ${currency}`;
}

export default function CheckoutPage() {
  const { user, backendUser, loading, refreshUser } = useAuth();
  const [showSignIn, setShowSignIn] = useState(false);
  const [order, setOrder] = useState<PaymentOrderRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const qrSrc = useMemo(() => qrImageSrc(order?.qr_image ?? null), [order]);
  const paid = order?.status === "paid" || Boolean(backendUser?.is_pro);

  async function createInvoice() {
    setCreating(true);
    setError("");
    try {
      const response = await createQPayPayment();
      setOrder(response.order);
    } catch (err) {
      setError(err instanceof Error ? err.message : "QuickPay invoice uusgej chadsangui.");
    } finally {
      setCreating(false);
    }
  }

  const checkStatus = useCallback(
    async (currentOrder = order) => {
      if (!currentOrder) return;
      setChecking(true);
      setError("");
      try {
        const response = await getQPayPaymentStatus(currentOrder.id);
        setOrder(response.order);
        if (response.paid) {
          await refreshUser();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Tulburiin tuluv shalgaj chadsangui.");
      } finally {
        setChecking(false);
      }
    },
    [order, refreshUser],
  );

  useEffect(() => {
    if (!order || paid) return;
    const id = window.setInterval(() => {
      void checkStatus(order);
    }, 5000);
    return () => window.clearInterval(id);
  }, [checkStatus, order, paid]);

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground">
        <Header onSignIn={() => setShowSignIn(true)} />

        <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 pb-16 pt-28 sm:px-6">
          <Link
            href="/"
            className="mb-8 inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Буцах
          </Link>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="space-y-6">
              <div className="space-y-3">
                <p className="text-sm font-medium text-primary">HELEX Pro</p>
                <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">
                  Про эрх авах
                </h1>
                <p className="max-w-2xl text-base leading-7 text-muted-foreground">
                  QuickPay invoice үүсгээд QR-р төлнө. Төлбөр
                  баталгаажмагц notes, AI assistant болон хязгааргүй видео үзэх
                  эрх идэвхжинэ.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  "3 үнэгүй видеоны дараа хязгааргүй",
                  "Notes ашиглах",
                  "AI assistant ашиглах",
                ].map((item) => (
                  <div key={item} className="rounded-md border border-border p-4 text-sm">
                    <CheckCircle2 className="mb-3 h-5 w-5 text-primary" />
                    {item}
                  </div>
                ))}
              </div>

              {!user && !loading ? (
                <div className="rounded-md border border-border p-5">
                  <p className="mb-4 text-sm text-muted-foreground">
                    Төлбөр үүсгэхийн өмнө Firebase account-аар нэвтэрнэ.
                  </p>
                  <Button onClick={() => setShowSignIn(true)}>Нэвтрэх</Button>
                </div>
              ) : null}

              {user && !paid && !order ? (
                <Button onClick={createInvoice} disabled={creating} size="lg">
                  {creating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CreditCard className="mr-2 h-4 w-4" />
                  )}
                  QuickPay-р төлөх
                </Button>
              ) : null}

              {error ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                  {error}
                </div>
              ) : null}
            </section>

            <aside className="rounded-md border border-border p-5">
              {paid ? (
                <div className="space-y-4 text-center">
                  <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
                  <h2 className="text-xl font-semibold">Про эрх идэвхтэй</h2>
                  <p className="text-sm text-muted-foreground">
                    Төлбөр баталгаажсан. Одоо notes болон AI assistant ашиглаж болно.
                  </p>
                  <Button asChild className="w-full">
                    <Link href="/">Үргэлжлүүлэх</Link>
                  </Button>
                </div>
              ) : order ? (
                <div className="space-y-5">
                  <div>
                    <p className="text-sm text-muted-foreground">Төлөх дүн</p>
                    <p className="text-2xl font-semibold">
                      {money(order.amount, order.currency)}
                    </p>
                  </div>

                  {qrSrc ? (
                    <div className="rounded-md border border-border bg-white p-3">
                      <Image
                        src={qrSrc}
                        alt="QuickPay QR"
                        width={256}
                        height={256}
                        unoptimized
                        className="mx-auto aspect-square w-full max-w-64"
                      />
                    </div>
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded-md border border-border">
                      <QrCode className="h-16 w-16 text-muted-foreground" />
                    </div>
                  )}

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => void checkStatus()}
                    disabled={checking}
                  >
                    {checking ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Төлөв шалгах
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 text-sm text-muted-foreground">
                  <CreditCard className="h-8 w-8 text-foreground" />
                  <p>QuickPay invoice үүсгэсний дараа QR код энд харагдана.</p>
                </div>
              )}
            </aside>
          </div>
        </main>

        {showSignIn && <SignInModal onClose={() => setShowSignIn(false)} />}
      </div>
    </ThemeProvider>
  );
}
