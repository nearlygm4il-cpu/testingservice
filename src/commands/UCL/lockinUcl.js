import { SlashCommandBuilder } from 'discord.js';
import { addLockinOptions, runLockin } from '../../utils/lockin.js';

const COMPETITION = {
    label: 'Champions League',
    emoji: '🏆',
    channelId: '1570544826477318194',
};

export default {
    data: addLockinOptions(
        new SlashCommandBuilder()
            .setName('lockin-ucl')
            .setDescription('Lock in your official predictions for the Champions League'),
    ),

    async execute(interaction) {
        return runLockin(interaction, COMPETITION);
    },
};
