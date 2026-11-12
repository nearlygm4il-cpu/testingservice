import {
    SlashCommandBuilder,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
} from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';

const ADMIN_CHANNEL_ID = '1570251983913222185';
const MAX_MATCHES = 30;
const REVIEW_TIME_MS = 5 * 60 * 1000;

// "Armenia vs Cyprus 0-1/1-2"  (prediction 2 is optional)
const ENTRY = /^\s*(.+?)\s+(?:vs\.?|v)\s+(.+?)\s+(\d+)\s*[-–:]\s*(\d+)(?:\s*[\/|]\s*(\d+)\s*[-–:]\s*(\d+))?\s*$/i;

function cleanName(name) {
    return name.trim().split(/\s+/).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function parsePredictions(text) {
    const parts = text.split(/[,;\n]/).filter((p) => p.trim());
    if (!parts.length) return { error: "You didn't enter any predictions." };
    if (parts.length > MAX_MATCHES) {
        return { error: `Too many matches. The maximum is ${MAX_MATCHES} per lock-in.` };
    }
    const fixtures = [];
    for (let i = 0; i < parts.length; i++) {
        const m = parts[i].match(ENTRY);
        if (!m) {
            return {
                error:
                    `Couldn't read entry **${i + 1}**: \`${parts[i].trim()}\`\n` +
                    'Use this format: `Home vs Away 0-1/1-2` and separate matches with commas.',
            };
        }
        fixtures.push({
            home: cleanName(m[1]),
            away: cleanName(m[2]),
            p1: [m[3], m[4]],
            p2: m[5] !== undefined ? [m[5], m[6]] : null,
        });
    }
    return { fixtures };
}

function buildEmbed(roleName, fixtures, final = false) {
    const blocks = fixtures.map((f) => {
        let b = `**${f.home} vs ${f.away}**\n**Prediction 1:** ${f.p1[0]}–${f.p1[1]}`;
        if (f.p2) b += `\n**Prediction 2:** ${f.p2[0]}–${f.p2[1]}`;
        return b;
    });
    const intro = final ? 'Official predictions.' : 'Please check every prediction before confirming.';
    const embed = createEmbed({
        title: `${final ? '✅ Locked in' : '🔎 Review Lock-in'} — ${roleName}`,
        description: `${intro} · ${fixtures.length} match(es)\n\n${blocks.join('\n\n')}`,
        color: final ? 'success' : 'primary',
    });
    if (final) embed.setTimestamp();
    else embed.setFooter({ text: 'Nothing is saved until you press Confirm & lock in.' });
    return embed;
}

export default {
    data: new SlashCommandBuilder()
        .setName('lockin')
        .setDescription("Lock in your club's official predictions")
        .addRoleOption((o) =>
            o.setName('team_role')
                .setDescription('Select the Discord role for the club you represent.')
                .setRequired(true))
        .addStringOption((o) =>
            o.setName('predictions')
                .setDescription('e.g. Armenia vs Cyprus 0-1/1-2, Italy vs France 1-2/0-3')
                .setRequired(true)),

    async execute(interaction) {
        try {
            if (!interaction.inGuild()) {
                return await interaction.reply({
                    content: 'Use this command in the server.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            const role = interaction.options.getRole('team_role', true);
            const text = interaction.options.getString('predictions', true);

            const memberRoles = interaction.member.roles;
            const hasRole = Array.isArray(memberRoles)
                ? memberRoles.includes(role.id)
                : memberRoles.cache.has(role.id);

            if (role.id === interaction.guildId || !hasRole) {
                return await interaction.reply({
                    content: 'You can only lock in for a club role you actually have.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            const { fixtures, error } = parsePredictions(text);
            if (error) {
                return await interaction.reply({ content: `❌ ${error}`, flags: MessageFlags.Ephemeral });
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('lockin_confirm')
                    .setLabel('Confirm & lock in')
                    .setEmoji('🔒')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('lockin_cancel')
                    .setLabel('Cancel')
                    .setEmoji('✖️')
                    .setStyle(ButtonStyle.Secondary),
            );

            await interaction.reply({
                embeds: [buildEmbed(role.name, fixtures)],
                components: [row],
                flags: MessageFlags.Ephemeral,
            });
            const reply = await interaction.fetchReply();

            let handled = false;
            const collector = reply.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: (i) => i.user.id === interaction.user.id,
                time: REVIEW_TIME_MS,
            });

            collector.on('collect', async (i) => {
                if (handled) return;
                handled = true;
                collector.stop('handled');

                try {
                    if (i.customId === 'lockin_cancel') {
                        return await i.update({
                            content: 'Cancelled. Nothing was sent.',
                            embeds: [],
                            components: [],
                        });
                    }

                    const final = buildEmbed(role.name, fixtures, true);
                    await i.update({
                        content: `✅ Official predictions locked in for **${role.name}**!\n${fixtures.length} match(es) accepted.`,
                        embeds: [final],
                        components: [],
                    });

                    try {
                        const channel = await interaction.client.channels.fetch(ADMIN_CHANNEL_ID);
                        await channel.send({
                            content: `📥 <@${interaction.user.id}> locked in predictions for <@&${role.id}>`,
                            embeds: [final],
                            allowedMentions: { parse: [] },
                        });
                    } catch (sendError) {
                        logger.error('Lockin: could not post to admins channel:', sendError);
                        await i.followUp({
                            content: "⚠️ Your predictions were accepted but I couldn't reach the admins channel. Please tell an admin.",
                            flags: MessageFlags.Ephemeral,
                        }).catch(() => {});
                    }
                } catch (buttonError) {
                    logger.error('Lockin button error:', buttonError);
                }
            });

            collector.on('end', async (_collected, reason) => {
                if (reason === 'time' && !handled) {
                    await interaction.editReply({
                        content: 'This lock-in expired. Please run /lockin again.',
                        embeds: [],
                        components: [],
                    }).catch(() => {});
                }
            });
        } catch (error) {
            logger.error('Lockin command error:', error);
            const payload = {
                embeds: [createEmbed({
                    title: 'System Error',
                    description: 'Something went wrong with /lockin. Please try again.',
                    color: 'error',
                })],
                flags: MessageFlags.Ephemeral,
            };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(payload).catch(() => {});
            } else {
                await interaction.reply(payload).catch(() => {});
            }
        }
    },
};
