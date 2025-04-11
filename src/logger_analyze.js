// Azure Function: logger_analyze/index.js
// Description: This function analyzes logs and sends the analysis to a Teams channel via a webhook.
// It uses OpenAI's API to generate the analysis and stores logs in Azure Table Storage to check for new logs.  
// It also uses the Azure Functions SDK, Axios for HTTP requests, and the Azure Data Tables SDK for interacting with Azure Table Storage.
// The function is triggered by an HTTP request and requires authentication.
// It expects a JSON payload with a "logs" field, which is an array of log objects. Each log object can contain various properties like message, level, url, and snippet.
// The function checks if the logs are new by creating a hash of each log object and checking if it exists in the Azure Table Storage.
// If the log is new, it stores it in the table with a timestamp and other relevant information.
// After processing the logs, it sends the analysis result to a Teams channel using a webhook URL.
// The analysis is done by sending a request to OpenAI's API with a specific prompt and the logs data.
// The function handles errors gracefully and returns appropriate HTTP status codes and messages.
// It also logs the process for debugging purposes.
// Import necessary modules and packages
import { app } from '@azure/functions';
import axios from 'axios';
import { TableClient, AzureNamedKeyCredential } from '@azure/data-tables';
import crypto from 'crypto';

const STORAGE_ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const STORAGE_ACCOUNT_KEY = process.env.AZURE_STORAGE_ACCOUNT_KEY;
const TABLE_NAME = process.env.AZURE_TABLE_NAME || 'LogHistory';

const credential = new AzureNamedKeyCredential(STORAGE_ACCOUNT_NAME, STORAGE_ACCOUNT_KEY);
const tableClient = new TableClient(
  `https://${STORAGE_ACCOUNT_NAME}.table.core.windows.net`,
  TABLE_NAME,
  credential
);

app.http('logger_analyze', {
  methods: ['POST'],
  authLevel: 'function',
  handler: async (request, context) => {
    try {
      const logData = await request.json();
      if (!logData || !Array.isArray(logData.logs)) {
        return {
          status: 400,
          body: { error: "logs 필드가 없거나 배열이 아닙니다." },
        };
      }

      // 로그 해시 기반 신규 여부 판단
      const logsWithHistoryCheck = await Promise.all(
        logData.logs.map(async (log) => {
          const hash = crypto.createHash('sha256').update(JSON.stringify(log)).digest('hex');
          const partitionKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
          const rowKey = hash;
          let isNew = false;

          try {
            await tableClient.getEntity(partitionKey, rowKey);
          } catch (e) {
            if (e.statusCode === 404) {

              const MAX_LOG_TEXT_LENGTH = 5000;
              const MAX_SNIPPET_LENGTH = 1000;
              isNew = true;

              await tableClient.createEntity({
                partitionKey,
                rowKey,
                createdAt: new Date().toISOString(),
                message: log.message || '',
                level: log.level || '',
                url: log.url || '',
                snippet: log.snippet?.slice(0, MAX_SNIPPET_LENGTH) || '', // 길이 제한
                logText: JSON.stringify(log).slice(0, MAX_LOG_TEXT_LENGTH), // 길이 제한
              });
            }
          }
          return { ...log, _isNew: isNew };
        })
      );

      const logContent = JSON.stringify(logsWithHistoryCheck, null, 2);
      const openaiUrl = `${process.env.OPENAI_ENDPOINT}/openai/deployments/${process.env.OPENAI_DEPLOYMENT}/chat/completions?api-version=2024-05-01-preview`;

        const messages = [
          {
            role
              : "system",
            content
              : "마지막 assistant가 의견을 종합해 최종 분석을 작성 종합해서 분석하되, 반드시 자연어 설명 + 핵심 결과(JSON 형태)를 함께 포함하세요."
          },
          {
            role
              : "assistant",
            content
              : `
          당신은 콘솔 로그 유형을 식별하는 전문가입니다.
               역할: User로 부터 식별 된 전체 로그 각각에 대해 아래 기준으로 설명하세요:
          1. isNew : 새로운 유형인지 여부 (과거에 비해 드문지)
          2. 기술적 성격: 네트워크 실패 / JavaScript 오류 / 리소스 누락 등 분류
          3. URL 기준 발생 위치 요약
          4. snippet을 통해 소스 코드 분석
               결과는 JSON 배열 형식으로 작성하세요:
          [
            {
              "newType": true,
              "type": "네트워크 실패",
              "url": "https://example.com/page",
              "Code" " 9165 | \t\t\t\t\t\t}\n    9166 | \t\t\t\t\t};\n    9167 | \t\t\t\t}\n    9168 | \n    9169 | \t\t\t\t// Create the abort callback\n    9170 | \t\t\t\tcallback = callback( \"abort\" );\n    9171 | \n    9172 | \t\t\t\ttry {\n    9173 | \n    9174 | \t\t\t\t\t// Do send the request (this may raise an exception)\n>>  9175 | \t\t\t\t\txhr.send( options.hasContent && options.data || null );\n    9176 | \t\t\t\t} catch ( e ) {\n    9177 | \n    9178 | \t\t\t\t\t// #14683: Only rethrow if this hasn't been notified as an error yet\n    9179 | \t\t\t\t\tif ( callback ) {\n    9180 | \t\t\t\t\t\tthrow e;\n    9181 | \t\t\t\t\t}\n    9182 | \t\t\t\t}\n    9183 | \t\t\t},\n    9184 | \n    9185 | \t\t\tabort: function() {""
            },
            ...
          ]
          `
          },
          {
            role
              : "assistant",
            content
              : `
          당신은 로그의 실무 중요도를 평가하는 전문가입니다.
               역할: User로 부터 식별 된 전체 로그들에 대한 다음 항목을 작성하세요:
          1. 실제 사이트 기능 또는 사용자 경험에 미치는 영향
          2. 중요도 별점[위험도, 사용자 경험에 미치는 영향, 발생빈도 기반으로 5점 만점으로 소수점 첫째 자리까지 산정하세요. Code(snippet)이 있는 경우 0.6점 가산하고 신규로그 일 경우 1점 가산하시오.]
               평가 이유는 실제 프론트 UI/UX 관점에서 기술적으로 상세히 설명하세요.
          `
          },
          {
            role
              : "assistant",
            content
              : `
          당신은 로그의 기술적 원인을 분석하는 전문가입니다.
               역할: 위의 assistant의 중요도 별점 참고하여 전체 로그 중 가장 중요도 별점이 높은 로그 1개에 대해서만 상세 원인을 분석하세요:
          1. 발생 배경 (예: CDN 오류, JS 예외, 보안 정책 등)
          2. Code(snippet)가 있다면 분석을 통해 근본 원인을 적어주세요. (예: 누락된 리소스, CORS 설정, 404 응답 등)
          3. 반복 가능성 또는 시스템 영향
               가능하면 원인과 관련된 Code(snippet) 분석을 통한 근거를 포함하세요.
          `
          },
          {
            role
              : "assistant",
            content
              : `
          당신은 웹 개발 실무자로서 에러메세지, Code(snippet)를 활용하여 대응 방안을 제시해야 합니다.
               역할: 위 assistant가 선정한 가장 중요도가 높은 하나의 로그에 대해서만 다음 내용을 제안하세요:
          1. 즉각적인 대응 방안 (예: 리소스 경로 점검, CDN 캐시 무효화 등)
          2. 예방을 위한 프론트/백엔드 코드 개선 방안
          3. 대응 예시 (CSS 설정, JS fallback 등 실제 코드로 표현, Code(snippet)이 있다면 해당 부분을 수정하세요.)
               실무자가 보고 바로 이해할 수 있게 명확하고 구체적으로 기술하세요.
          `
          },
          {
            role
              : "assistant",
            content
              : `
          당신은 위의 전문가 의견들을 종합해, **최종 분석 리포트**를 작성해야 합니다.
             역할: 아래 형식으로 작성하세요, 굵기 또한 아래형식을 맞추세요. 핵심 로그 요약까지는 여러개가 나올 수 있고 원인 분석부터는 중요도가 가장 높은 한개에 대해서만 상세 분석하세요 :
             ※ 발생 위치 앞 중요도	이모지	예시 표현
               - 4.5점 이상:🔥
               - 4점 이상:⚠️	
               - 3.5점 이상:ℹ️
    
    
          Format은 아래와 같습니다.
    
    
          ## 📌 핵심 로그 요약(중요도 높은 TOP 3)
    
          1. (중요도 가장 높은 오류) 발생 위치 URL: 
          유형 및 메세지: 
          중요도 별점(숫자와 별 그림, 별점 이유): 
          2. (중요도 두번째 높은 오류) 발생 위치 URL:
          유형 및 메세지: 
          중요도 별점(숫자와 별 그림, 별점 이유): 
          3. (중요도 세번째 높은 오류) 발생 위치 URL:
          발생 위치 URL: 
          유형 및 메세지: 
          중요도 별점(숫자와 별 그림, 별점 이유): 
         
    
          ## 📌 원인 분석(중요도 TOP1 오류)
    
          - 발생배경
          - 발생 소스코드 js 위치와 Error Line(있을 경우에만)
          - 근본 원인
          - 에러 메세지
          - 반복 가능성 및 시스템 영향
    
          ## 📌 대응 방안(중요도 TOP1 오류)
    
          - 즉각적인 대응 방안
          - 예방을 위한 개선 방안
          - 대응 코드[Code(snippet)가 있으면 소스 코드 부분에 직접 수정해서 보여주세요.]
              
          ## 📌 비즈니스 또는 사용자 경험에 미치는 영향까지 언급하세요.(중요도 높은거 하나만)
          `
          },
          {
            role: "user",
            content: `다음 JSON 로그를 자연어 설명과 함께 분석해주세요.
                   로그 데이터: ${logContent}`
          },
        ];
    
        const response = await axios.post(
          openaiUrl,
          {
            messages,
            max_tokens: 9192,
            temperature: 0.7,
            top_p: 1,
          },
          {
            headers: {
              "api-key": process.env.OPENAI_API_KEY,
              "Content-Type": "application/json",
            },
          }
        );
  
        const result = response.data?.choices?.[0]?.message?.content;
  
        if (!result) {
          context.log("⚠️ 응답은 200이지만 분석 결과가 없습니다.");
          return {
            status: 204,
            body: { message: "분석 결과 없음" },
          };
        }
  
        try {
          await axios.post(process.env.TEAMS_WEBHOOK_URL, {
            text: `[COS_SIS_LOG_ANALYSIS_오늘의 오류]\n\n${result.slice(0, 5000)}${result.length > 5000 ? '...' : ''}`,
          });
          context.log("✅ Teams Webhook 전송 완료");
        } catch (err) {
          context.log("❌ Teams 전송 실패:", err.message);
        }
  
        return {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            summary: result,
          },
        };
      } catch (err) {
        context.log("분석 중 오류 발생:", err.response?.data || err.message);
        return {
          status: 500,
          body: { error: err.message },
        };
      }
    }
  });
  
  
  
  