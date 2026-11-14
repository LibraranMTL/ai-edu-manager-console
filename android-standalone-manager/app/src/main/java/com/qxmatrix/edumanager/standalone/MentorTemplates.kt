package com.qxmatrix.edumanager.standalone

/** Mirrors Android student terminal mentor actions; prompts contain scope labels, never archive contents. */
object MentorTemplates {
    val learningGroups = listOf("学习", "互动", "测验", "核验", "计划")
    val learningActions = listOf(
        listOf("学习卡片｜把当前内容整理成可复习的问答卡片。", "思维导图｜梳理概念、关系、前提和待核实项。", "信息图｜将已知资料转成边界清楚的图文摘要。", "图表总结｜选择合适图表呈现资料中的数量与趋势。"),
        listOf("学习辅导｜按当前难度与时长进行分步讲解和追问。", "费曼讲解｜用自己的话讲清概念，再暴露理解缺口。", "游戏化学习｜把明确知识点转成小挑战，不把得分当掌握结论。", "动画视频脚本｜生成服务于一个明确学习目标的短脚本。"),
        listOf("分步测验｜从诊断到反馈，保留每一步依据。", "错题复盘｜区分错误类型、证据和下一次验证。"),
        listOf("来源核验｜检查资料来源、日期、适用条件和可访问性。", "事实核查｜区分事实、推断、观点和待核实信息。", "反例检查｜主动寻找会削弱当前结论的条件或证据。", "论证审查｜检查主张、证据、假设和推理跳跃。"),
        listOf("目标设定｜把愿望转成可观察、可复盘的短期目标。", "学习计划｜按时间、资源和已知困难安排下一步。", "本周行动｜形成不超过三项、带完成标志的行动。", "学习总结｜按事实、证据、困难和下一步回顾。")
    )
    val projectStages = listOf("定义问题 · 4 项行动", "方案比较 · 4 项行动", "制定计划 · 4 项行动", "研究与原型 · 4 项行动", "阶段复盘 · 4 项行动", "成果展示交流 · 4 项行动")
    val projectActions = listOf(
        listOf("第一性原理拆解与重建｜从硬约束、已验证事实、假设与未知项向上重建可测试路径。", "使用者与场景澄清｜把宽泛主题转换为可观察、可描述和可验证的真实情境。", "范围与研究问题收敛｜在当前资源内形成可完成、可留证的问题。", "假设与验证设计｜把方向、效果和价值主张拆成可证伪假设与最小验证。"),
        listOf("SWOT 与决策矩阵｜让方案取舍可追溯、可反驳，不用伪精确总分替代判断。", "决策准则与证据检查｜先审查为什么这样比较，再审查每个判断的依据。", "取舍实验与反例｜把方案争论转换为能区分路径的最小测试。", "决策备忘与撤销条件｜记录当前选择依据、强度和重新决策条件。"),
        listOf("项目计划：里程碑与风险｜把确认方向转成有产出、完成标志和现实依赖的项目路径。", "资源、角色与关键路径｜识别真正阻塞交付的资源、角色、批准和任务依赖。", "研究与证据计划｜建立项目判断到来源、数据、观察和记录的证据路线。", "风险登记与预案｜把影响项目的事件转成可监测、可应对的风险条目。"),
        listOf("研究问题与资料质量审查｜审查资料能回答什么、适用于谁、可信度如何以及仍缺什么。", "原型/实验设计｜设计回答一个明确问题的最小原型或实验。", "测试数据与观察记录｜把原始结果、直接观察、反馈、异常与解释分开整理。", "迭代诊断与下一轮测试｜从现有结果提出可检验诊断，并只改变一个关键因素。"),
        listOf("周复盘与下一步｜把完成事实、计划变化、阻塞、证据和下一步分开。", "计划偏差与根因复盘｜解释计划与实际差异并提出可验证改进，不归咎个人。", "学习与决策日志｜记录当时知道什么、为何改变以及改变后要验证什么。", "优先级重排｜按交付价值、依赖、证据缺口和剩余资源重排工作。"),
        listOf("受众与核心主张｜明确向特定受众表达一个能被现有证据支持的主张。", "证据链与展品选择｜让每个展示主张追溯到合适证据并删去无效材料。", "叙事、演示与讲稿｜把问题、选择、验证、结果、限制和下一步组织成证据驱动表达。", "质询与答辩演练｜用分层追问训练诚实、简洁、可追溯的回答。")
    )

    fun label(action: String) = action.substringBefore('｜')
    private fun hostInstructions(action: HostMentorAction): String =
        "## 角色与任务\n你是${action.role}。${action.task}\n\n## 执行协议\n" +
            action.workflow.mapIndexed { index, item -> "${index + 1}. $item" }.joinToString("\n") +
            "\n\n## 输出要求\n${action.output}\n\n## 质量与成功标准\n${action.success}\n" +
            if (action.boundary.isNotBlank()) "\n## 动作边界\n${action.boundary}\n" else ""
    fun learning(studentName: String, studentId: String, group: Int, action: Int): String {
        require(studentName.isNotBlank() && studentId.isNotBlank())
        val text = learningActions[group][action]
        return "# 学习导师 · ${label(text)}\n\n## 当前范围\n- 学生：$studentName（$studentId）\n- 学习模式：${learningGroups[group]}\n\n" +
            "## 本次任务\n${text.substringAfter('｜')}\n\n" + hostInstructions(HostMentorActions.learning[group][action]) + "\n## 使用边界\n- 只使用当前对话中用户主动提供的内容；如需读取本机资料，先确认当前学生授权。\n" +
            "- 资料数量、单次答题或一次项目经历都不直接等同于掌握、能力或成长结论。\n- 不自动发送、归档或改写本机资料。\n\n" +
            "## 开始方式\n先用不超过 5 行确认本次目标、难度、时长和资料范围；若信息不足，只问一个最影响学习效果的问题。"
    }
    fun project(studentName: String, studentId: String, projectName: String, projectId: String, stage: Int, action: Int): String {
        require(studentName.isNotBlank() && studentId.isNotBlank() && projectName.isNotBlank() && projectId.isNotBlank())
        val text = projectActions[stage][action]
        return "# 项目导师 · ${label(text)}\n\n## 当前范围\n- 学生：$studentName（$studentId）\n- 项目：$projectName（$projectId）\n- 阶段：${projectStages[stage]}\n\n" +
            "## 本次任务\n${text.substringAfter('｜')}\n\n" + hostInstructions(HostMentorActions.project[stage][action]) + "\n## 使用边界\n- 仅使用用户在当前对话主动提供的项目资料，或先在受控工具中确认同一学生和项目的授权。\n" +
            "- 明确区分资料事实、合理推断、假设与缺失信息。\n- 不自动发送、查询或写回项目资料；任何归档均须另行确认并取得真实回执。\n" +
            "- 不把一次尝试、项目经历或 Agent 文本表述为学生已掌握的能力。\n\n" +
            "## 开始方式\n先用不超过 5 行复述任务、当前资料范围和成功标准；如缺少关键信息，只问一个最影响结果的问题，然后给出可核验的下一步。"
    }
}
