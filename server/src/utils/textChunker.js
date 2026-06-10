class TextChunker {
  constructor(options = {}) {
    this.maxChunkSize = options.maxChunkSize || 2000;
    this.minSentenceLength = options.minSentenceLength || 5;
    this.sentenceEndings = ['.', '!', '?', '。', '！', '？', '；', ';', '\n'];
    this.paragraphBreaks = ['\n\n', '\r\n\r\n'];
  }

  splitText(text) {
    if (!text || typeof text !== 'string') return [];
    
    const sentences = this.splitIntoSentences(text);
    const chunks = this.groupIntoChunks(sentences);
    
    return chunks.map((chunk, index) => ({
      id: index,
      text: chunk.text,
      sentenceCount: chunk.sentenceCount,
      isFirst: index === 0,
      isLast: index === chunks.length - 1
    }));
  }

  splitIntoSentences(text) {
    const sentences = [];
    let current = '';
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      current += char;
      
      if (this.sentenceEndings.includes(char)) {
        const nextChar = text[i + 1];
        if (!nextChar || nextChar !== '.' ) {
          const trimmed = current.trim();
          if (trimmed.length > 0) {
            sentences.push(trimmed);
          }
          current = '';
        }
      }
    }
    
    if (current.trim().length > 0) {
      sentences.push(current.trim());
    }
    
    return sentences;
  }

  groupIntoChunks(sentences) {
    const chunks = [];
    let currentChunk = { text: '', sentenceCount: 0 };
    
    for (const sentence of sentences) {
      const potentialChunk = currentChunk.text 
        ? currentChunk.text + ' ' + sentence 
        : sentence;
      
      if (potentialChunk.length <= this.maxChunkSize || currentChunk.sentenceCount === 0) {
        currentChunk.text = potentialChunk;
        currentChunk.sentenceCount++;
      } else {
        chunks.push({ ...currentChunk });
        currentChunk = { text: sentence, sentenceCount: 1 };
      }
    }
    
    if (currentChunk.sentenceCount > 0) {
      chunks.push(currentChunk);
    }
    
    return chunks;
  }

  preserveFormat(text) {
    return {
      original: text,
      lineBreaks: text.split('\n').length - 1,
      paragraphs: text.split(/\n\s*\n/).length
    };
  }

  restoreFormat(translatedText, formatInfo) {
    return translatedText;
  }
}

module.exports = TextChunker;
