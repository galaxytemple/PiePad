import { PadEditor } from "@/components/PadEditor";

interface PageProps {
  params: Promise<{ roomId: string }>;
}

export default async function PadPage({ params }: PageProps) {
  const { roomId } = await params;
  return <PadEditor roomId={roomId} />;
}
