import MiniReaderFrame from './product/MiniReaderFrame';
import WordCard from './product/WordCard';

export default function ReaderPreview() {
  return (
    <div className="w-full max-w-xl">
      <MiniReaderFrame title="The Economist">
        <p className="font-reading text-[15px] leading-relaxed text-ink">
          The magazine published a{' '}
          <span
            className="rounded-sm"
            style={{
              backgroundColor: '#fdf0eb',
              boxShadow: '0 0 0 1.5px #c87455',
            }}
          >
            candid
          </span>{' '}
          assessment of the global economy.
        </p>

        <div className="mt-4">
          <WordCard
            word="candid"
            phonetic="/ˈkændɪd/"
            pos="adj."
            definition="truthful and straightforward, even when the truth is awkward."
            definitionZh="坦率的，直白的（结合上下文：一份坦率的评估）"
            baseForm="candid"
            examTags={['GRE']}
          />
        </div>
      </MiniReaderFrame>
    </div>
  );
}
