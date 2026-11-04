import { useMemo } from 'react';
import { parseMarkdown } from '../state/markdown.js';

function Inline({ nodes }) {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'code':
        return <code key={index}>{node.text}</code>;
      case 'strong':
        return (
          <strong key={index}>
            <Inline nodes={node.children} />
          </strong>
        );
      case 'em':
        return (
          <em key={index}>
            <Inline nodes={node.children} />
          </em>
        );
      case 'link':
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">
            <Inline nodes={node.children} />
          </a>
        );
      default:
        return node.text;
    }
  });
}

// The docs' own `#` title is the details summary, so their headings start at h4 under the dialog's h2/h3.
const headingTag = (level) => `h${Math.min(level + 3, 6)}`;

function Block({ block }) {
  switch (block.type) {
    case 'heading': {
      const Tag = headingTag(block.level);
      return (
        <Tag>
          <Inline nodes={block.children} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p>
          <Inline nodes={block.children} />
        </p>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag>
          {block.items.map((item, index) => (
            <li key={index}>
              <Inline nodes={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case 'code':
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      );
    case 'quote':
      return (
        <blockquote>
          <Blocks blocks={block.children} />
        </blockquote>
      );
    case 'rule':
      return <hr />;
    case 'table':
      return (
        <div className="markdown-table" tabIndex={0} role="region" aria-label="Scrollable table">
          <table>
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index} scope="col" style={cell.align ? { textAlign: cell.align } : undefined}>
                    <Inline nodes={cell.children} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} style={cell.align ? { textAlign: cell.align } : undefined}>
                      <Inline nodes={cell.children} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

function Blocks({ blocks }) {
  return blocks.map((block, index) => <Block key={index} block={block} />);
}

export default function Markdown({ text }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="markdown">
      <Blocks blocks={blocks} />
    </div>
  );
}
