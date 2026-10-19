export interface Post {
  slug: string;
  title: string;
}

const posts: Post[] = [
  { slug: "hello", title: "Hello" },
  { slug: "world", title: "World" },
];

export function listSlugs(): string[] {
  return posts.map((p) => p.slug);
}

export function getPost(slug: string): Post | undefined {
  return posts.find((p) => p.slug === slug);
}
