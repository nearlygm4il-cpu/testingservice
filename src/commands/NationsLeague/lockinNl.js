import { SlashCommandBuilder } from 'discord.js';
import { addLockinOptions, runLockin } from '../../utils/lockin.js';

const COMPETITION = {
    label: 'Nations League',
    emoji: '🌍',
    channelId: '1570544855674003526',
};

export default {
    data: addLockinOptions(
        new SlashCommandBuilder()
            .setName('lockin-nl')
            .setDescription('Lock in your official predictions for the Nations League'),
    ),

    async execute(interaction) {
        return runLockin(interaction, COMPETITION);
    },
};
