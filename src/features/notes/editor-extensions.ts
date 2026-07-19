import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";

export function createEditorExtensions({
  placeholder = true,
}: { placeholder?: boolean } = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
    }),
    Link.configure({
      autolink: true,
      defaultProtocol: "https",
      openOnClick: false,
      protocols: ["http", "https", "mailto"],
      HTMLAttributes: {
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    ...(placeholder
      ? [
          Placeholder.configure({
            placeholder: "Start writing, or type @ to connect a note…",
          }),
        ]
      : []),
  ];
}
