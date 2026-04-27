import { redirect } from "next/navigation";

export default async function ContainerPage({
  params,
}: {
  params: Promise<{ container: string }>;
}) {
  const { container } = await params;
  redirect(`/${container}/system`);
}
