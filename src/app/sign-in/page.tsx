import { GoogleButton } from "./google-button";

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-3xl font-bold">Job Hunter</h1>
        <GoogleButton />
      </div>
    </main>
  );
}
