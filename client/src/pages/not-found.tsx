import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-lg font-semibold">Página no encontrada</p>
      <Link href="/" className="mt-2 inline-block text-sm text-primary hover:underline">Volver a Hoy</Link>
    </div>
  );
}
