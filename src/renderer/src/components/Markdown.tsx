import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const PLUGINS = [remarkGfm]

export const Markdown = memo(function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="markdown text-[14.5px] leading-7 text-ink">
      <ReactMarkdown remarkPlugins={PLUGINS}>{text}</ReactMarkdown>
    </div>
  )
})
