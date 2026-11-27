import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const now = new Date().toISOString();
const day = (offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
};
async function main() {
    await prisma.task.deleteMany();
    await prisma.section.deleteMany();
    await prisma.project.deleteMany();
    await prisma.label.deleteMany();
    await prisma.filter.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.project.create({
        data: {
            id: 'inbox',
            name: 'Inbox',
            color: '#dc4c3e',
            orderKey: '000000000000000',
            isInbox: true,
            layout: 'list',
            createdAt: now,
            updatedAt: now,
        },
    });
    const work = await prisma.project.create({
        data: {
            id: 'prj_work',
            name: 'Work',
            color: '#246fe0',
            orderKey: '000000000001024',
            layout: 'board',
            createdAt: now,
            updatedAt: now,
        },
    });
    await prisma.section.createMany({
        data: [
            { id: 'sec_work_todo', projectId: work.id, name: 'To do', orderKey: '000000000001024', createdAt: now, updatedAt: now },
            { id: 'sec_work_doing', projectId: work.id, name: 'In progress', orderKey: '000000000002048', createdAt: now, updatedAt: now },
        ],
    });
    await prisma.label.createMany({
        data: [
            { id: 'lbl_work', name: 'work', color: '#246fe0', orderKey: '000000000001024', createdAt: now, updatedAt: now },
            { id: 'lbl_home', name: 'home', color: '#058527', orderKey: '000000000002048', createdAt: now, updatedAt: now },
            { id: 'lbl_urgent', name: 'urgent', color: '#d1453b', orderKey: '000000000003072', createdAt: now, updatedAt: now },
        ],
    });
    await prisma.filter.createMany({
        data: [
            { id: 'flt_p1', name: 'High priority', query: 'p1 | p2', color: '#d1453b', orderKey: '000000000001024', createdAt: now, updatedAt: now },
            { id: 'flt_overdue', name: 'Overdue', query: 'overdue & !#Inbox', color: '#eb8909', orderKey: '000000000002048', createdAt: now, updatedAt: now },
            { id: 'flt_week', name: 'This week', query: '7 days & @work', color: '#692ec2', orderKey: '000000000003072', createdAt: now, updatedAt: now },
        ],
    });
    await prisma.task.createMany({
        data: [
            {
                id: 'tsk_welcome',
                projectId: 'inbox',
                content: 'Welcome to __AYAtodoist — press Q to quick-add a task',
                description: 'Everything here is a plugin. Try the AI agent from the sparkles button.',
                priority: 2,
                orderKey: '000000000001024',
                dueDate: day(0),
                labels: JSON.stringify(['work']),
                createdAt: now,
                updatedAt: now,
            },
            {
                id: 'tsk_plan',
                projectId: work.id,
                sectionId: 'sec_work_todo',
                content: 'Draft the plugin SDK guide',
                priority: 1,
                orderKey: '000000000001024',
                dueDate: day(1),
                dueTime: '10:00',
                durationMinutes: 60,
                createdAt: now,
                updatedAt: now,
            },
            {
                id: 'tsk_review',
                projectId: work.id,
                sectionId: 'sec_work_doing',
                content: 'Review today’s completed tasks',
                priority: 3,
                orderKey: '000000000002048',
                dueDate: day(-1),
                recurrence: JSON.stringify({ text: 'every friday', unit: 'week', interval: 1, weekdays: [5], strict: false }),
                labels: JSON.stringify(['urgent']),
                createdAt: now,
                updatedAt: now,
            },
        ],
    });
    await prisma.setting.upsert({
        where: { id: 'app' },
        create: {
            id: 'app',
            payload: JSON.stringify({
                theme: 'dark',
                language: 'ar',
                sidebarCollapsed: false,
                weekStart: 6,
                timeFormat: '24h',
                shortcutsEnabled: true,
                agent: {},
                display: {},
                enabledPlugins: {},
            }),
            updatedAt: now,
        },
        update: {},
    });
    console.log('Seed complete: 2 projects, 2 sections, 3 labels, 3 filters, 3 tasks.');
}
main()
    .catch((error) => {
    console.error(error);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
