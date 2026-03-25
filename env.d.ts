declare module "virtual:astro-synthesia/manifest" {
  const manifest: Record<
    string,
    {
      videoId: string;
      status: "in_progress" | "complete" | "error";
      shareUrl: string | null;
      thumbnailUrl: string | null;
      duration: string | null;
      scriptPreview: string;
      avatar: string;
      provisionedAt: string;
      completedAt: string | null;
    }
  >;
  export default manifest;
}
