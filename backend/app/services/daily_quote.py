"""每日一句 — 英文名句库 + 按日期确定性取句。

名句按日期序数（epoch days）对名句库长度取模轮换：
同一天固定返回同一条，跨天自动切换，无需存储、无状态。

名句数据存放在 ``daily_quotes`` 表（管理后台可增删改/启停），首次启动
自动以本文件的内置列表（``DAILY_QUOTES``）为种子填充；表中无可用名句时
回退到内置列表。
"""

from datetime import date
from typing import Dict, List

from sqlalchemy import func, select

from app.models.daily_quote import DailyQuote

DAILY_QUOTES: List[Dict[str, str]] = [
    {
        "en": "The only way to do great work is to love what you do.",
        "zh": "成就伟业的唯一途径，就是热爱你所做的事。",
        "author": "Steve Jobs",
    },
    {
        "en": "Stay hungry, stay foolish.",
        "zh": "求知若饥，虚心若愚。",
        "author": "Steve Jobs",
    },
    {
        "en": "It does not matter how slowly you go as long as you do not stop.",
        "zh": "前进得慢并不重要，只要你不停止前进。",
        "author": "Confucius",
    },
    {
        "en": "Success is not final, failure is not fatal: it is the courage to continue that counts.",
        "zh": "成功不是终点，失败也并非末日，重要的是继续前行的勇气。",
        "author": "Winston Churchill",
    },
    {
        "en": "The future belongs to those who believe in the beauty of their dreams.",
        "zh": "未来属于那些相信自己梦想之美的人。",
        "author": "Eleanor Roosevelt",
    },
    {
        "en": "In the middle of every difficulty lies opportunity.",
        "zh": "每一个困境之中，都潜藏着机遇。",
        "author": "Albert Einstein",
    },
    {
        "en": "Life is what happens when you're busy making other plans.",
        "zh": "生活就是当你忙于制定别的计划时，发生在你身上的事。",
        "author": "John Lennon",
    },
    {
        "en": "The best way to predict the future is to create it.",
        "zh": "预测未来的最好方式，就是去创造未来。",
        "author": "Peter Drucker",
    },
    {
        "en": "Do what you can, with what you have, where you are.",
        "zh": "尽你所能，用你所有，在你能做之处，把事做成。",
        "author": "Theodore Roosevelt",
    },
    {
        "en": "Happiness is not something ready made. It comes from your own actions.",
        "zh": "幸福并非现成之物，它来自你自己的行动。",
        "author": "Dalai Lama",
    },
    {
        "en": "The journey of a thousand miles begins with a single step.",
        "zh": "千里之行，始于足下。",
        "author": "Lao Tzu",
    },
    {
        "en": "Well done is better than well said.",
        "zh": "做得好，胜过说得好。",
        "author": "Benjamin Franklin",
    },
    {
        "en": "Whether you think you can or you think you can't, you're right.",
        "zh": "你认为自己行，或认为自己不行，你都是对的。",
        "author": "Henry Ford",
    },
    {
        "en": "Simplicity is the ultimate sophistication.",
        "zh": "简单，是最高级的精致。",
        "author": "Leonardo da Vinci",
    },
    {
        "en": "Not all those who wander are lost.",
        "zh": "并非所有漂泊的人都在迷失方向。",
        "author": "J. R. R. Tolkien",
    },
    {
        "en": "The only impossible journey is the one you never begin.",
        "zh": "唯一无法完成的旅程，是你从未开始的旅程。",
        "author": "Tony Robbins",
    },
    {
        "en": "It always seems impossible until it's done.",
        "zh": "事情在没有做成之前，总是显得不可能。",
        "author": "Nelson Mandela",
    },
    {
        "en": "What we achieve inwardly will change outer reality.",
        "zh": "我们内在的成长，终将改变外在的现实。",
        "author": "Plutarch",
    },
    {
        "en": "The secret of getting ahead is getting started.",
        "zh": "领先的秘诀，就是先行动起来。",
        "author": "Mark Twain",
    },
    {
        "en": "Quality is not an act, it is a habit.",
        "zh": "优秀不是一次行为，而是一种习惯。",
        "author": "Aristotle",
    },
    {
        "en": "Turn your wounds into wisdom.",
        "zh": "把伤疤化作智慧。",
        "author": "Oprah Winfrey",
    },
    {
        "en": "Nothing is impossible. The word itself says 'I'm possible!'",
        "zh": "没有什么是不可能的，不可能这个词本身就写着「我能行」。",
        "author": "Audrey Hepburn",
    },
    {
        "en": "Be the change that you wish to see in the world.",
        "zh": "做你想在这世上看到的改变。",
        "author": "Mahatma Gandhi",
    },
    {
        "en": "Dream big and dare to fail.",
        "zh": "敢想大梦想，也敢去试错。",
        "author": "Norman Vaughan",
    },
    {
        "en": "Your time is limited, so don't waste it living someone else's life.",
        "zh": "你的时间有限，别浪费在过别人的生活上。",
        "author": "Steve Jobs",
    },
    {
        "en": "The harder you work for something, the greater you'll feel when you achieve it.",
        "zh": "你为某件事付出的努力越多，达成它时的成就感就越大。",
        "author": "Unknown",
    },
    {
        "en": "Fall seven times and stand up eight.",
        "zh": "跌倒七次，就要站起来八次。",
        "author": "Japanese Proverb",
    },
    {
        "en": "A winner is a dreamer who never gives up.",
        "zh": "赢家，是永不言弃的追梦人。",
        "author": "Nelson Mandela",
    },
    {
        "en": "Courage is not the absence of fear, but the triumph over it.",
        "zh": "勇气不是无所畏惧，而是战胜恐惧。",
        "author": "Nelson Mandela",
    },
    {
        "en": "The way to get started is to quit talking and begin doing.",
        "zh": "开始行动的方式，就是停止空谈，动手去做。",
        "author": "Walt Disney",
    },
    {
        "en": "Opportunities don't happen. You create them.",
        "zh": "机遇不会自己到来，而是由你创造。",
        "author": "Chris Grosser",
    },
    {
        "en": "Don't watch the clock; do what it does. Keep going.",
        "zh": "别盯着时钟看，像它一样坚持走下去。",
        "author": "Sam Levenson",
    },
    {
        "en": "Believe you can and you're halfway there.",
        "zh": "相信自己能行，你就已经成功了一半。",
        "author": "Theodore Roosevelt",
    },
    {
        "en": "What you do today can improve all your tomorrows.",
        "zh": "今天你所做的，能改善你所有的明天。",
        "author": "Ralph Marston",
    },
    {
        "en": "The greatest glory in living lies not in never falling, but in rising every time we fall.",
        "zh": "生命中最伟大的荣耀，不在于从未跌倒，而在于每次跌倒后都能重新站起。",
        "author": "Nelson Mandela",
    },
    {
        "en": "Do one thing every day that scares you.",
        "zh": "每天做一件让你害怕的事。",
        "author": "Eleanor Roosevelt",
    },
    {
        "en": "It's not whether you get knocked down, it's whether you get up.",
        "zh": "重要的不是你是否被击倒，而是你是否站起来。",
        "author": "Vince Lombardi",
    },
    {
        "en": "Challenges are what make life interesting and overcoming them is what makes life meaningful.",
        "zh": "挑战让生活变得有趣，而战胜挑战则让生活有了意义。",
        "author": "Joshua J. Marine",
    },
    {
        "en": "Start where you are. Use what you have. Do what you can.",
        "zh": "从你所在之处开始，用你拥有的一切，做你能做的事。",
        "author": "Arthur Ashe",
    },
    {
        "en": "You are never too old to set another goal or to dream a new dream.",
        "zh": "无论何时，你都不会老到无法设定新目标、追逐新梦想。",
        "author": "C. S. Lewis",
    },
    {
        "en": "Never bend your head. Always hold it high.",
        "zh": "永远不要低头，始终高昂起头颅。",
        "author": "Helen Keller",
    },
    {
        "en": "A goal without a plan is just a wish.",
        "zh": "没有计划的目标，只是一个愿望。",
        "author": "Antoine de Saint-Exupéry",
    },
    {
        "en": "Learn from yesterday, live for today, hope for tomorrow.",
        "zh": "从昨天学习，为今天而活，向明天怀抱希望。",
        "author": "Albert Einstein",
    },
    {
        "en": "Small steps in the right direction can turn out to be the biggest step of your life.",
        "zh": "朝着正确方向迈出的小步，可能是你人生中最重要的一步。",
        "author": "Unknown",
    },
    {
        "en": "Eighty percent of success is showing up.",
        "zh": "成功有八成在于到场、在于开始。",
        "author": "Woody Allen",
    },
    {
        "en": "The only limit to our realization of tomorrow is our doubts of today.",
        "zh": "实现明天理想的唯一限制，是我们今天的疑虑。",
        "author": "Franklin D. Roosevelt",
    },
    {
        "en": "Act as if what you do makes a difference. It does.",
        "zh": "去做吧，仿佛你所做的会带来改变——事实正是如此。",
        "author": "William James",
    },
    {
        "en": "Perseverance is not a long race; it is many short races one after the other.",
        "zh": "坚持不是一场长跑，而是一场接一场的短跑。",
        "author": "Walter Elliot",
    },
    {
        "en": "Great things never come from comfort zones.",
        "zh": "伟大的成就，从不诞生于舒适区。",
        "author": "Unknown",
    },
    {
        "en": "Doubt kills more dreams than failure ever will.",
        "zh": "怀疑扼杀的梦想，比失败更多。",
        "author": "Suzy Kassem",
    },
    {
        "en": "What we fear doing most is usually what we most need to do.",
        "zh": "我们最害怕去做的事，往往正是我们最需要做的事。",
        "author": "Tim Ferriss",
    },
    {
        "en": "Life isn't about finding yourself. Life is about creating yourself.",
        "zh": "生活不是寻找自我，而是创造自我。",
        "author": "George Bernard Shaw",
    },
    {
        "en": "The best time to plant a tree was 20 years ago. The second best time is now.",
        "zh": "种一棵树最好的时间是二十年前，其次就是现在。",
        "author": "Chinese Proverb",
    },
    {
        "en": "Nothing in life is to be feared, it is only to be understood.",
        "zh": "生活中没有什么值得恐惧，只有等待被理解。",
        "author": "Marie Curie",
    },
    {
        "en": "Don't judge each day by the harvest you reap but by the seeds that you plant.",
        "zh": "不要用收获来衡量每一天，而要用你播下的种子。",
        "author": "Robert Louis Stevenson",
    },
    {
        "en": "If you can dream it, you can do it.",
        "zh": "只要你能梦想，你就能做到。",
        "author": "Walt Disney",
    },
    {
        "en": "Strive not to be a success, but rather to be of value.",
        "zh": "不要追求成功，而要追求创造价值。",
        "author": "Albert Einstein",
    },
    {
        "en": "You must be the change you wish to see in the world.",
        "zh": "你必须成为你希望在这世上看到的改变。",
        "author": "Mahatma Gandhi",
    },
    {
        "en": "The sun himself is weak when he first rises, and gathers strength and courage as the day gets on.",
        "zh": "太阳初升时也很微弱，随白昼推移才渐强起来。",
        "author": "Charles Dickens",
    },
    {
        "en": "You can't use up creativity. The more you use, the more you have.",
        "zh": "创造力取之不尽，你用得越多，拥有的就越多。",
        "author": "Maya Angelou",
    },
]


def pick_quote_by_date(day: date, quotes: List[Dict[str, str]]) -> Dict[str, str]:
    """纯函数：按日期序数从名句列表中确定性地取一条。

    - 同一天内调用结果一致
    - 跨天后自动轮换到下一句
    """
    return quotes[day.toordinal() % len(quotes)]


async def get_daily_quote(day: date | None = None, db=None) -> Dict[str, str]:
    """返回当天的名句。

    优先从 ``daily_quotes`` 表取（仅 active 行），按日期取模轮换；
    表中没有可用名句时回退到内置列表 ``DAILY_QUOTES``。
    """
    target = day or date.today()
    if db is not None:
        rows = (
            await db.execute(
                select(DailyQuote).where(DailyQuote.active.is_(True))
            )
        ).scalars().all()
        if rows:
            pick = rows[target.toordinal() % len(rows)]
            return {
                "en": pick.text_en,
                "zh": pick.text_zh,
                "author": pick.author,
            }
    return pick_quote_by_date(target, DAILY_QUOTES)


async def seed_daily_quotes(db) -> int:
    """若 ``daily_quotes`` 表为空，用内置列表填充种子数据。

    返回插入的行数（已存在则返回 0）。
    """
    count = (await db.execute(select(func.count(DailyQuote.id)))).scalar() or 0
    if count > 0:
        return 0
    db.add_all(
        [
            DailyQuote(text_en=q["en"], text_zh=q["zh"], author=q["author"])
            for q in DAILY_QUOTES
        ]
    )
    await db.commit()
    return len(DAILY_QUOTES)
