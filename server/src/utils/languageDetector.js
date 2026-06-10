class LanguageDetector {
  constructor() {
    this.langProfiles = {
      zh: {
        name: 'Chinese',
        chars: ['的', '一', '是', '在', '不', '了', '有', '和', '人', '这', '中', '大', '为', '上', '个'],
        cjkRatio: 0.5
      },
      en: {
        name: 'English',
        commonWords: ['the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with']
      },
      ja: {
        name: 'Japanese',
        chars: ['の', 'に', 'は', 'を', 'た', 'が', 'で', 'て', 'と', 'し', 'れ', 'さ', 'る', 'あ', 'い'],
        cjkRatio: 0.3
      },
      ko: {
        name: 'Korean',
        chars: ['이', '은', '는', '의', '에', '를', '을', '가', '와', '과', '로', '으로', '에서', '에게', '께']
      },
      fr: {
        name: 'French',
        commonWords: ['le', 'de', 'un', 'être', 'et', 'à', 'il', 'avoir', 'ne', 'je', 'son', 'que', 'se', 'qui', 'ce']
      },
      de: {
        name: 'German',
        commonWords: ['der', 'und', 'sein', 'zu', 'haben', 'werden', 'sie', 'nicht', 'von', 'ich', 'es', 'und', 'in', 'den', 'auf']
      },
      es: {
        name: 'Spanish',
        commonWords: ['el', 'de', 'ser', 'y', 'a', 'en', 'un', 'ser', 'haber', 'por', 'con', 'su', 'para', 'como', 'estar']
      }
    };
  }

  detect(text) {
    if (!text || text.trim().length === 0) {
      return { language: 'unknown', confidence: 0
      };
    }

    const results = [];
    
    results.push(this.detectCJK(text));
    results.push(this.detectByCommonWords(text, 'en'));
    results.push(this.detectByCommonWords(text, 'fr'));
    results.push(this.detectByCommonWords(text, 'de'));
    results.push(this.detectByCommonWords(text, 'es'));
    results.push(this.detectHangul(text));

    results.sort((a, b) => b.confidence - a.confidence);
    
    return results[0];
  }

  detectCJK(text) {
    const cjkRegex = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g;
    const cjkChars = text.match(cjkRegex) || [];
    const cjkCount = cjkChars.length;
    const totalChars = text.replace(/\s/g, '').length;
    
    if (totalChars === 0) {
      return { language: 'unknown', confidence: 0 };
    }

    const ratio = cjkCount / totalChars;

    if (ratio > 0.1) {
      const zhCount = this.countChineseChars(text);
      const jaCount = this.countJapaneseChars(text);
      
      if (zhCount > jaCount * 2) {
        return { language: 'zh', confidence: Math.min(0.95, ratio + 0.3) };
      } else if (jaCount > zhCount * 2) {
        return { language: 'ja', confidence: Math.min(0.9, ratio + 0.2) };
      } else {
        return { language: 'zh', confidence: 0.7 };
      }
    }
    
    return { language: 'unknown', confidence: 0 };
  }

  countChineseChars(text) {
    const zhRegex = /[\u4e00-\u9fff]/g;
    return (text.match(zhRegex) || []).length;
  }

  countJapaneseChars(text) {
    const jaRegex = /[\u3040-\u309f\u30a0-\u30ff]/g;
    return (text.match(jaRegex) || []).length;
  }

  detectHangul(text) {
    const hangulRegex = /[\uac00-\ud7af\u1100-\u11ff]/g;
    const hangulChars = text.match(hangulRegex) || [];
    const totalChars = text.replace(/\s/g, '').length;
    
    if (totalChars === 0) return { language: 'unknown', confidence: 0 };
    
    const ratio = hangulChars.length / totalChars;
    
    if (ratio > 0.2) {
      return { language: 'ko', confidence: Math.min(0.95, ratio + 0.3) };
    }
    
    return { language: 'unknown', confidence: 0 };
  }

  detectByCommonWords(text, lang) {
    const profile = this.langProfiles[lang];
    if (!profile || !profile.commonWords) {
      return { language: lang, confidence: 0 };
    }

    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return { language: lang, confidence: 0 };

    let matchCount = 0;
    for (const word of words) {
      const cleanWord = word.replace(/[^a-zA-Z]/g, '');
      if (profile.commonWords.includes(cleanWord.toLowerCase())) {
        matchCount++;
      }
    }

    const confidence = matchCount / words.length;
    return { language: lang, confidence: Math.min(0.8, confidence * 3) };
  }
}

module.exports = LanguageDetector;
