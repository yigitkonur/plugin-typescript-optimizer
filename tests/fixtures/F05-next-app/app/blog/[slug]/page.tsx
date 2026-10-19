import { getPost, listSlugs } from "@/lib/posts";

export function generateStaticParams() {
  return listSlugs().map((slug) => ({ slug }));
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  return <article>{post ? post.title : "missing"}</article>;
}
