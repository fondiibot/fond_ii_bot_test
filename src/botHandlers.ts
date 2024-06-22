import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { MyContext, User } from './types';
import { 
  addOrUpdateUser, 
  disableMessagesByChatId,
  addSimpleEvent,
  storeCommand,
} from './database/database';
import {
  RESET_MESSAGE,
  NO_VIDEO_ERROR,
  HELP_MESSAGE,
} from './config';
import { 
  handleMessage, 
  handleVoiceMessage, 
  handleAudioFile, 
  handlePhotoMessage 
} from './messageHandlers';
import { formatLogMessage } from './utils/utils';
import { generateMessageBufferKey } from './utils/messageUtils';
import { pineconeIndex } from './vectorDatabase';

// Create a map to store the message buffers
const messageBuffers = new Map();

export function initializeBotHandlers(bot: Telegraf<MyContext>) {

  bot.start(async (ctx: MyContext) => {
    console.log(formatLogMessage(ctx, 'start command received'));
    if (ctx.from && ctx.from.id) {
      await addOrUpdateUser({
        user_id: ctx.from.id,
        username: ctx.from?.username || null,
        default_language_code: ctx.from.language_code,
        language_code: ctx.from.language_code,
      } as User);
      console.log(formatLogMessage(ctx, 'user saved to the database'));
    } else {
      throw new Error('ctx.from.id is undefined');
    }
    ctx.reply(HELP_MESSAGE);
  });

  bot.help((ctx: MyContext) => {
    ctx.reply(HELP_MESSAGE);
  });

  bot.command('reset', (ctx: MyContext) => {
    console.log(formatLogMessage(ctx, `/reset command received`));
    if (ctx.chat && ctx.chat.id) {
      disableMessagesByChatId(ctx.chat.id);
    } else {
      throw new Error(`ctx.chat.id is undefined`);
    }
    console.log(formatLogMessage(ctx, `messages deleted from database`));
    ctx.reply(RESET_MESSAGE);
    storeCommand(ctx, 'reset');
  });

  bot.on(message('photo'), async (ctx: MyContext) => {
    console.log(formatLogMessage(ctx, `photo received`));
    await handlePhotoMessage(ctx, pineconeIndex);
  });

  bot.on(message('video'), (ctx: MyContext) => {
    console.log(formatLogMessage(ctx, `video received`));
    ctx.reply(NO_VIDEO_ERROR);
    addSimpleEvent(ctx, 'user_message', 'user', 'video');
  });

  bot.on(message('sticker'), (ctx: MyContext) => {
    console.log(formatLogMessage(ctx, `sticker received`));
    ctx.reply('👍');
    addSimpleEvent(ctx, 'user_message', 'user', 'sticker');
  });

  bot.on(message('voice'), async (ctx: MyContext) => {
    console.log(formatLogMessage(ctx, `[NEW] voice received`));
    handleVoiceMessage(ctx, pineconeIndex);
  });

  bot.on(message('text'), async (ctx: MyContext) => {
    console.log(formatLogMessage(ctx, '[NEW] text received'));
    const key = generateMessageBufferKey(ctx);
    const messageData = messageBuffers.get(key) || { messages: [], timer: null };

    // @ts-ignore
    messageData.messages.push(ctx.message?.text || '');

    // Clear the old timer
    if (messageData.timer) {
      clearTimeout(messageData.timer);
    }

    // Set a new timer
    messageData.timer = setTimeout(async () => {
      // '<|endoftext|>' is a special token that marks the end of a text in OpenAI's and prohibited in the messages
      const fullMessage = messageData.messages?.join('\n').replace(/<\|endoftext\|>/g, '[__openai_token_endoftext__]') || '';
      console.log(formatLogMessage(ctx, `full message collected. length: ${fullMessage.length}`));
      messageData.messages = []; // Clear the messages array

      await handleMessage(ctx, fullMessage, 'user_message', 'text', pineconeIndex);
    }, 4000);

    // Save the message buffer
    messageBuffers.set(key, messageData);
  });

  bot.on(message('document'), async (ctx: MyContext) => {
    // @ts-ignore
    const fileId = ctx.message.document?.file_id;
    // @ts-ignore
    const fileName = ctx.message.document?.file_name;
    // @ts-ignore
    const mimeType = ctx.message.document?.mime_type;

    if (fileId && mimeType) {
      if (mimeType.startsWith('audio/')) {
        await handleAudioFile(ctx, fileId, mimeType, pineconeIndex);
      } else {
        console.log(formatLogMessage(ctx, `File received: ${fileName} (${mimeType})`));
        // ctx.reply(`Received file: ${fileName} with MIME type: ${mimeType}`);
        ctx.reply('I can only process audio files and compresed photos for now.');
      }
    } else {
      console.error(formatLogMessage(ctx, 'Received file, but file_id or mimeType is undefined'));
    }
  });

  bot.on(message('audio'), async (ctx: MyContext) => {
    // @ts-ignore
    const fileId = ctx.message.audio?.file_id;
    // @ts-ignore
    const mimeType = ctx.message.audio?.mime_type;

    if (fileId && mimeType) {
      await handleAudioFile(ctx, fileId, mimeType, pineconeIndex);
    } else {
      console.error(formatLogMessage(ctx, 'Received audio file, but file_id or mimeType is undefined'));
    }
  });

}