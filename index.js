const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ComponentType 
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

const TOKEN = 'YOUR_BOT_TOKEN_HERE';
const CURRENCY_NAME = "فولتا";
const ADMIN_ROLE_ID = "1472225010134421676";

// قاعدة بيانات بسيطة (تنتهي بانتهاء تشغيل البوت - يفضل لاحقاً ربطها بـ MongoDB أو Quick.db)
let db = {}; 

function getUserData(userId) {
    if (!db[userId]) {
        db[userId] = { balance: 0, transactions: [] };
    }
    return db[userId];
}

// دالة لتحويل الاختصارات (1m, 2k) إلى أرقام
function parseAmount(input) {
    const match = input.toLowerCase().match(/^(\d+(\.\d+)?)([km])?$/);
    if (!match) return null;
    let value = parseFloat(match[1]);
    const unit = match[3];
    if (unit === 'k') value *= 1000;
    if (unit === 'm') value *= 1000000;
    return Math.floor(value);
}

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // --- أمر رصيد ---
    if (command === 'رصيد') {
        const data = getUserData(message.author.id);
        const embed = new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle(`🏦 مصرف ${CURRENCY_NAME}`)
            .setThumbnail(message.author.displayAvatarURL())
            .addFields(
                { name: '💰 رصيدك الحالي:', value: `**${data.balance.toLocaleString()}** ${CURRENCY_NAME}`, inline: false },
                { name: '📜 سجل العمليات:', value: `\`\`\`${data.transactions.slice(-5).join('\n') || 'لا توجد عمليات'}\`\`\`` }
            )
            .setFooter({ text: `طلب بواسطة: ${message.author.username}` });

        return message.reply({ embeds: [embed] });
    }

    // --- أمر إضافة (للإدارة فقط) ---
    if (command === 'اضافة') {
        if (!message.member.roles.cache.has(ADMIN_ROLE_ID)) {
            return message.reply("❌ ليس لديك صلاحية الإدارة.");
        }

        const user = message.mentions.users.first();
        const amount = parseAmount(args[1]);

        if (!user || isNaN(amount)) return message.reply("⚠️ الاستخدام: `!اضافة @user 50k` ");

        const data = getUserData(user.id);
        data.balance += amount;
        data.transactions.push(`إيداع إداري: +${amount.toLocaleString()}`);

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setDescription(`✅ تمت إضافة **${amount.toLocaleString()}** ${CURRENCY_NAME} إلى حساب ${user}`);
        
        return message.reply({ embeds: [embed] });
    }

    // --- أمر تحويل (من شخص لآخر) ---
    if (command === 'تحويل') {
        const user = message.mentions.users.first();
        const amount = parseAmount(args[1]);

        if (!user || isNaN(amount) || user.id === message.author.id) {
            return message.reply("⚠️ الاستخدام: `!تحويل @user 1000` ");
        }

        const senderData = getUserData(message.author.id);
        if (senderData.balance < amount) return message.reply("❌ رصيدك من الفولتا لا يكفي.");

        const receiverData = getUserData(user.id);

        // تنفيذ العملية
        senderData.balance -= amount;
        receiverData.balance += amount;

        senderData.transactions.push(`تحويل إلى ${user.username}: -${amount.toLocaleString()}`);
        receiverData.transactions.push(`استلام من ${message.author.username}: +${amount.toLocaleString()}`);

        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('💸 حوالة بنكية ناجحة')
            .addFields(
                { name: 'المُرسل:', value: `${message.author}`, inline: true },
                { name: 'المُستلم:', value: `${user}`, inline: true },
                { name: 'المبلغ:', value: `**${amount.toLocaleString()}** ${CURRENCY_NAME}`, inline: false }
            );

        return message.reply({ embeds: [embed] });
    }

    // --- أمر كريدت (نظام طلبات) ---
    if (command === 'كريدت') {
        const amount = parseAmount(args[0]);
        if (isNaN(amount)) return message.reply("⚠️ يرجى كتابة المبلغ. مثال: `!كريدت 2m` ");

        const data = getUserData(message.author.id);
        if (data.balance < amount) return message.reply("❌ رصيدك لا يكفي لهذا الطلب.");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('confirm_cr').setLabel('قبول').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('cancel_cr').setLabel('إلغاء').setStyle(ButtonStyle.Danger)
        );

        const response = await message.reply({
            content: `⚠️ ${message.author}، هل أنت متأكد من تحويل **${amount.toLocaleString()}** ${CURRENCY_NAME} إلى كريدت؟ ستخصم فوراً.`,
            components: [row]
        });

        const collector = response.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30000 });

        collector.on('collect', async (i) => {
            if (i.user.id !== message.author.id) return i.reply({ content: 'هذا الزر ليس لك!', ephemeral: true });

            if (i.customId === 'confirm_cr') {
                // التأكد مرة أخرى من الرصيد لحظة الضغط
                if (data.balance < amount) return i.update({ content: "❌ عذراً، رصيدك نقص قبل تأكيد العملية.", components: [] });

                // سحب المبلغ
                data.balance -= amount;
                data.transactions.push(`تحويل لكريدت (طلب): -${amount.toLocaleString()}`);

                const resultEmbed = new EmbedBuilder()
                    .setColor(0x9B59B6)
                    .setTitle('📋 تم تسجيل طلب الكريدت')
                    .addFields(
                        { name: 'الاسم:', value: `${message.author.username}`, inline: true },
                        { name: 'الأيدي (ID):', value: `\`${message.author.id}\``, inline: true },
                        { name: 'المبلغ المسحوب:', value: `**${amount.toLocaleString()}** ${CURRENCY_NAME}`, inline: false }
                    )
                    .setFooter({ text: 'تم خصم الفولتا بنجاح' });

                await i.update({ content: null, embeds: [resultEmbed], components: [] });
            } else {
                await i.update({ content: '❌ تم إلغاء طلب التحويل.', components: [] });
            }
        });
    }
});

client.once('ready', () => console.log(`✅ ${client.user.tag} جاهز للعمل!`));
client.login(process.env.TOKEN);
