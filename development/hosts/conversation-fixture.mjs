export const makePage=()=>({api:{protocol:'gemini',url:'https://example.com/v1',key:'',model:'model',supplier:'test',trustedTarget:''},model:{inputs:['text']},draft:'',attachments:[],messages:[],history:[],pendingTextId:null,aspectRatio:'1:1',imageSize:'1K',busy:false,lastUsage:null,lastMetrics:null});
export const makeData=()=>({chat:makePage(),image:makePage()});
