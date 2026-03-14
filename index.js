const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ComponentType,
    Partials 
} = require('discord.js');
const http = require('http');

// نظام Keep-alive لضمان استقرار البوت على الاستضافة
http.createServer((req, res) => {
    res.write("Bot is running!");
    res.end();
}).listen(8080);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers,   
    ],
    partials: [Partials.Message, Partials.Channel, Partials.User]
});

// --- الإعدادات الأساسية ---
const TOKEN = process.env.TOKEN; 
const CURRENCY_NAME = "فولتا";
const ADMIN_ROLE_ID = "1472225010134421676"; // رتبة الإدارة
const CREDIT_LOG_CHANNEL = "1477107661383401472"; // قناة استلام طلبات الكريدت

// قاعدة بيانات وهمية (تصفر عند إعادة التشغيل)
let db = {}; 

function getUserData(userId) {
    if (!db[userId]) {
        db[userId] = { balance: 0, transactions: [] };
    }
    return db[userId];
}

function parseAmount(input) {
    if (!input) return null;
    const match = input.toLowerCase().match(/^(\d+(\.\d+)?)([km])?$/);
    if (!match) return null;
    let value = parseFloat(match[1]);
    if (match[3] === 'k') value *= 1000;
    if (match[3] === 'm') value *= 1000000;
    return Math.floor(value);
}

client.once('ready', (c) => {
    console.log(`✅ ${c.user.tag} جاهز للعمل بنظام فولتا!`);
});

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
            );
        return message.reply({ embeds: [embed] });
    }

    // --- أمر إضافة (إدارة فقط) ---
    if (command === 'اضافة') {
        if (!message.member.roles.cache.has(ADMIN_ROLE_ID)) return message.reply("❌ ليس لديك صلاحية الإدارة.");
        const user = message.mentions.users.first();
        const amount = parseAmount(args[1]);
        if (!user || isNaN(amount)) return message.reply("⚠️ الاستخدام: `!اضافة @user 100k` ");

        const data = getUserData(user.id);
        data.balance += amount;
        data.transactions.push(`إيداع إداري: +${amount.toLocaleString()}`);
        
        return message.reply({ embeds: [new EmbedBuilder().setColor(0x2ECC71).setDescription(`✅ تم إضافة **${amount.toLocaleString()}** إلى حساب ${user}`)] });
    }

    // --- أمر تحويل (من شخص لشخص) ---
    if (command === 'تحويل') {
        const user = message.mentions.users.first();
        const amount = parseAmount(args[1]);
        if (!user || isNaN(amount) || user.id === message.author.id) return message.reply("⚠️ الاستخدام: `!تحويل @user 500` ");

        const sender = getUserData(message.author.id);
        if (sender.balance < amount) return message.reply("❌ رصيدك من الفولتا لا يكفي.");

        const receiver = getUserData(user.id);
        sender.balance -= amount;
        receiver.balance += amount;
        
        sender.transactions.push(`تحويل إلى ${user.username}: -${amount.toLocaleString()}`);
        receiver.transactions.push(`استلام من ${message.author.username}: +${amount.toLocaleString()}`);

        return message.reply({ embeds: [new EmbedBuilder().setColor(0x3498DB).setTitle('💸 تحويل ناجح').setDescription(`تم تحويل **${amount.toLocaleString()}** إلى ${user}`)] });
    }

    // --- أمر كريدت (مع الإرسال لقناة الإدارة) ---
    if (command === 'كريدت') {
        const amount = parseAmount(args[0]);
        if (!amount || isNaN(amount)) return message.reply("⚠️ مثال: `!كريدت 1m` ");

        const data = getUserData(message.author.id);
        if (data.balance < amount) return message.reply("❌ رصيدك لا يكفي لإتمام الطلب.");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('confirm_cr').setLabel('قبول').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('cancel_cr').setLabel('إلغاء').setStyle(ButtonStyle.Danger)
        );

        const response = await message.reply({
            content: `⚠️ هل أنت متأكد من تحويل **${amount.toLocaleString()}** ${CURRENCY_NAME} إلى كريدت؟`,
            components: [row]
        });

        const collector = response.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30000 });

        collector.on('collect', async (i) => {
            if (i.user.id !== message.author.id) return i.reply({ content: 'الأمر ليس لك!', ephemeral: true });
            
            if (i.customId === 'confirm_cr') {
                if (data.balance < amount) return i.update({ content: "❌ عذراً، رصيدك نقص قبل التأكيد.", components: [] });

                // سحب المبلغ وتسجيل العملية
                data.balance -= amount;
                data.transactions.push(`تحويل كريدت: -${amount.toLocaleString()}`);

                // إنشاء القائمة (Embed)
                const logEmbed = new EmbedBuilder()
                    .setColor(0x9B59B6)
                    .setTitle('📋 طلب كريدت جديد')
                    .addFields(
                        { name: 'الاسم:', value: `${i.user.username}`, inline: true },
                        { name: 'الأيدي (ID):', value: `\`${i.user.id}\``, inline: true },
                        { name: 'المبلغ المسحوب:', value: `**${amount.toLocaleString()}** ${CURRENCY_NAME}`, inline: false }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'تم سحب المبلغ بنجاح من حساب المستخدم' });

                // إرسال الطلب لقناة الإدارة المحددة
                const logChannel = client.channels.cache.get(CREDIT_LOG_CHANNEL);
                if (logChannel) {
                    await logChannel.send({ embeds: [logEmbed] });
                }

                await i.update({ content: "✅ تم إرسال طلبك للإدارة وخصم المبلغ من حسابك.", embeds: [logEmbed], components: [] });
            } else {
                await i.update({ content: '❌ تم إلغاء العملية.', components: [] });
            }
        });
    }
});

client.login(TOKEN);
