export type DailyExpression = {
  expression: string;
  meaning: string;
  usage?: string;
};

export type DailyArticle = {
  id: string;
  slug: string;
  publishDate: string;
  titleZh: string;
  titleEn: string;
  subtitle?: string;
  topic: string;
  difficulty?: string;
  readingTime: number;
  focus: string[];
  background: string;
  perspectiveA: {
    title: string;
    claim: string;
    reasoning: string;
    explanation: string;
    example: string;
    conclusion?: string;
  };
  perspectiveB: {
    title: string;
    claim: string;
    reasoning: string;
    explanation: string;
    example: string;
    conclusion?: string;
  };
  counterargument: {
    target: string;
    concession: string;
    limitation: string;
    rebuttal: string;
    conclusion: string;
    pattern: string;
    patternUsage: string;
  };
  ideaBank: {
    ideas: string[];
    examples: string[];
    expressions: DailyExpression[];
    argumentPatterns: string[];
  };
  relatedQuestionIds: string[];
  keywords: string[];
};

export const dailyArticles: DailyArticle[] = [
  {
    id: "daily-2026-08-26-attendance",
    slug: "should-universities-require-attendance",
    publishDate: "2026-08-26",
    titleZh: "大学是否应该强制学生到课？",
    titleEn: "Should Universities Require Students to Attend Classes?",
    subtitle:
      "围绕课堂出勤制度，从学习责任、课堂参与和学生自主权三个角度分析这一问题。",
    topic: "教育学习",
    difficulty: "Intermediate",
    readingTime: 8,
    focus: ["Academic Discussion", "Argument Development", "Counterargument"],
    background:
      "University attendance policies are often discussed as a conflict between responsibility and autonomy. Some professors believe that required attendance helps students stay engaged, while others argue that college students should be trusted to manage their own learning. For TOEFL writing, this topic is useful because it naturally invites balanced reasoning, concrete examples, and a clear response to an opposing view.",
    perspectiveA: {
      title: "Required attendance can build academic accountability.",
      claim:
        "Universities should require students to attend certain classes because attendance can hold students accountable for their learning.",
      reasoning:
        "When attendance is entirely optional, some students may underestimate the value of steady participation, especially in courses where knowledge builds gradually.",
      explanation:
        "Regular classroom presence gives students repeated exposure to course concepts and allows them to notice gaps in understanding before those gaps become serious. It also creates a routine that supports long-term academic performance.",
      example:
        "For example, in a discussion-based sociology class, students often learn by responding to classmates' ideas. Reading slides after class may help them remember facts, but it cannot fully replace the experience of listening, questioning, and defending a position in real time.",
      conclusion:
        "For this reason, reasonable attendance requirements can encourage students to take their education more seriously.",
    },
    perspectiveB: {
      title: "Students should learn to manage their own education.",
      claim:
        "Universities should not force students to attend every class because college students are adults who need to develop independent learning habits.",
      reasoning:
        "A strict attendance policy may treat students as if they cannot make responsible decisions about their time.",
      explanation:
        "In reality, students have different learning styles and obligations. Some may learn more effectively by reviewing recordings, reading independently, or using class time to complete internships, research, or part-time work.",
      example:
        "For instance, a student who already understands a lecture topic might use that time to work on a lab project or meet with a professor. If the student can still demonstrate mastery, absence alone should not be treated as failure.",
      conclusion:
        "A flexible policy may better reflect the purpose of higher education: helping students become self-directed learners.",
    },
    counterargument: {
      target: "Students should have full freedom to decide whether to attend class.",
      concession:
        "This concern is understandable because autonomy is an important part of university education.",
      limitation:
        "However, the argument assumes that absence affects only the individual student.",
      rebuttal:
        "In many seminars, labs, and group-based courses, one student's absence can reduce the quality of discussion or make collaborative work less productive for others.",
      conclusion:
        "Therefore, even if universities should avoid overly strict rules, limited attendance requirements are still reasonable for courses that depend heavily on participation.",
      pattern:
        "While this concern is understandable, it overlooks the fact that...",
      patternUsage:
        "适合反驳看似合理但忽略某个条件的观点，例如自由、效率或便利性相关话题。",
    },
    ideaBank: {
      ideas: [
        "Accountability can improve academic performance.",
        "Student autonomy encourages independent learning.",
        "Participation matters more in discussion-based courses.",
      ],
      examples: [
        "Discussion seminars where students learn by responding to classmates.",
        "Laboratory or group projects where absence affects other students.",
      ],
      expressions: [
        {
          expression: "hold students accountable for...",
          meaning: "让学生对……负责",
          usage: "用于讨论教育制度、工作制度或规则是否能促进责任感。",
        },
        {
          expression: "encourage active participation",
          meaning: "鼓励积极参与",
          usage: "适合课堂讨论、社区活动、团队合作类话题。",
        },
        {
          expression: "develop independent learning habits",
          meaning: "培养自主学习习惯",
          usage: "用于支持学生自主权、在线学习或大学教育目的。",
        },
        {
          expression: "be detrimental to...",
          meaning: "对……有害",
          usage: "用于指出某项政策或行为的负面影响。",
        },
      ],
      argumentPatterns: [
        "Claim + Reason + Course-specific example",
        "Concession + Limitation + Rebuttal",
      ],
    },
    relatedQuestionIds: [],
    keywords: [
      "education",
      "attendance",
      "university",
      "autonomy",
      "participation",
    ],
  },
  {
    id: "daily-2026-08-25-ai-learning",
    slug: "should-students-use-ai-tools",
    publishDate: "2026-08-23",
    titleZh: "学生是否应该使用 AI 工具学习？",
    titleEn: "Should Students Use AI Tools for Learning?",
    subtitle: "分析 AI 学习工具在效率、依赖性和批判性思维方面的影响。",
    topic: "科技媒体",
    difficulty: "Intermediate",
    readingTime: 7,
    focus: ["Academic Discussion", "Examples", "Technology"],
    background:
      "AI tools can explain difficult concepts quickly, but they may also make students rely on instant answers. This topic helps TOEFL learners discuss technology with a balanced position.",
    perspectiveA: {
      title: "AI can make learning more accessible.",
      claim:
        "Students should be allowed to use AI tools because they can receive immediate explanations and personalized examples.",
      reasoning:
        "Not every student has constant access to teachers or tutors.",
      explanation:
        "When used responsibly, AI can help students review confusing material, compare examples, and prepare better questions for class.",
      example:
        "A student struggling with an economics concept can ask for several simple explanations before reading the textbook again.",
      conclusion:
        "AI can therefore support learning when students treat it as a guide rather than a shortcut.",
    },
    perspectiveB: {
      title: "Overuse can weaken independent thinking.",
      claim:
        "Students should be cautious about AI tools because easy answers can reduce the effort required for real understanding.",
      reasoning:
        "Learning often requires struggling with a problem before receiving an explanation.",
      explanation:
        "If students immediately ask AI for solutions, they may skip the process of forming their own ideas.",
      example:
        "A student who asks AI to outline every essay may finish assignments faster but become less confident when writing under exam conditions.",
      conclusion:
        "For this reason, AI should be used as support, not as a replacement for thinking.",
    },
    counterargument: {
      target: "AI tools simply make students lazy.",
      concession:
        "It is true that some students may use AI to avoid doing their own work.",
      limitation:
        "However, this problem comes from misuse rather than from the technology itself.",
      rebuttal:
        "With clear rules, students can use AI to clarify ideas while still producing their own arguments and examples.",
      conclusion:
        "The better solution is guidance, not a complete ban.",
      pattern:
        "The problem is not X itself, but the way X is used.",
      patternUsage:
        "适合科技、媒体、教育工具类话题，用于区分工具本身和使用方式。",
    },
    ideaBank: {
      ideas: [
        "Technology can expand access to learning resources.",
        "Convenience may reduce deep thinking if students misuse it.",
      ],
      examples: [
        "Using AI to generate practice questions before an exam.",
        "Depending on AI outlines without practicing independent writing.",
      ],
      expressions: [
        {
          expression: "personalized feedback",
          meaning: "个性化反馈",
          usage: "用于教育科技、在线学习和教师反馈话题。",
        },
        {
          expression: "overly dependent on...",
          meaning: "过度依赖……",
          usage: "用于讨论技术、父母帮助或学校制度带来的依赖。",
        },
      ],
      argumentPatterns: ["Benefit + condition", "Misuse vs. proper use"],
    },
    relatedQuestionIds: [
      "356a6ca8-8d53-4de9-9722-27c011e0beed",
    ],
    keywords: ["AI", "technology", "learning", "education"],
  },
  {
    id: "daily-2026-08-24-green-cities",
    slug: "should-cities-invest-in-green-spaces",
    publishDate: "2026-08-20",
    titleZh: "城市是否应该投入更多公园和绿地？",
    titleEn: "Should Cities Invest More in Parks and Green Spaces?",
    subtitle: "从公共健康、城市预算和长期生活质量角度讨论城市绿地。",
    topic: "环境城市",
    difficulty: "Intermediate",
    readingTime: 6,
    focus: ["Academic Discussion", "Public Policy", "Examples"],
    background:
      "As cities become denser, governments must decide whether parks and green spaces deserve limited public funds. This topic is useful for practicing trade-off reasoning.",
    perspectiveA: {
      title: "Green spaces improve public well-being.",
      claim:
        "Cities should invest more in parks because green spaces can improve residents' physical and mental health.",
      reasoning:
        "Urban residents often face stress, noise, and limited opportunities for outdoor activity.",
      explanation:
        "Parks provide places to exercise, relax, and interact with neighbors, which can improve community life.",
      example:
        "A neighborhood park may give children a safe place to play and older residents a place to walk every day.",
      conclusion:
        "These benefits can make cities healthier and more livable over time.",
    },
    perspectiveB: {
      title: "Cities must consider urgent budget priorities.",
      claim:
        "Although parks are valuable, cities should not always prioritize them over transportation, housing, or public safety.",
      reasoning:
        "Public budgets are limited, and some needs affect residents more immediately.",
      explanation:
        "If a city has unreliable buses or a shortage of affordable housing, spending heavily on parks may not solve its most serious problems.",
      example:
        "A low-income district might benefit more from improved public transit than from a new decorative park.",
      conclusion:
        "Green projects should be balanced with other public needs.",
    },
    counterargument: {
      target: "Parks are less important than practical infrastructure.",
      concession:
        "It is reasonable to argue that transportation and housing are essential.",
      limitation:
        "However, this view treats green space as a luxury rather than a form of public infrastructure.",
      rebuttal:
        "Because parks can improve health, reduce heat, and strengthen communities, they also serve practical urban functions.",
      conclusion:
        "A city does not have to choose between livability and practicality; green space can support both.",
      pattern:
        "This view treats A as merely B, but A also functions as C.",
      patternUsage:
        "适合反驳“某物只是装饰/娱乐/浪费钱”的观点。",
    },
    ideaBank: {
      ideas: [
        "Public spaces can improve both health and community connection.",
        "Government spending often requires trade-offs.",
      ],
      examples: [
        "Neighborhood parks for children and older residents.",
        "Transit improvements competing with environmental projects.",
      ],
      expressions: [
        {
          expression: "improve quality of life",
          meaning: "提升生活质量",
          usage: "适合城市、环境、工作制度等话题。",
        },
        {
          expression: "limited public funds",
          meaning: "有限的公共资金",
          usage: "用于政府预算和公共政策话题。",
        },
      ],
      argumentPatterns: ["Trade-off reasoning", "Long-term benefit argument"],
    },
    relatedQuestionIds: [
      "262ad472-8ecb-47b1-95f8-5001b3a791cc",
      "277ddfed-c3cc-4eda-a1df-3c0f9c700748",
      "7d39db7c-b967-4c77-9a2e-002518f5220c",
    ],
    keywords: ["environment", "city", "parks", "public policy"],
  },
];

export function getTodayDailyArticle(today = new Date()) {
  const todayKey = today.toISOString().slice(0, 10);

  return [...dailyArticles]
    .sort((left, right) => right.publishDate.localeCompare(left.publishDate))
    .find((article) => article.publishDate <= todayKey);
}
