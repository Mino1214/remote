"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    const result = await signIn("credentials", { email, password, redirect: false });
    setIsLoading(false);
    if (result?.error) {
      setError("로그인에 실패했습니다.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase text-primary">Remote Control</p>
          <h1 className="mt-1 text-3xl font-semibold">PC Control</h1>
        </div>
        <form className="space-y-3" onSubmit={onSubmit}>
          <Input
            placeholder="admin"
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            placeholder="비밀번호"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error ? <p className="text-sm text-primary">{error}</p> : null}
          <Button className="w-full" disabled={isLoading} type="submit">
            {isLoading ? "로그인 중..." : "로그인"}
          </Button>
        </form>
      </div>
    </div>
  );
}
