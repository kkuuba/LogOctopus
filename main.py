"""
Main programm loop works as service in background saving all logs contanet to one dataframe
Every 10 min all dataframe content is saved to some file
When service is started some cmd is executed which make sure that every cmd will be save in hisroty with timestamps
Every 10 minutes script checks for cmd which were executed and for each of them saves correspodngi logs with results info to dataframe
When user eneter cmd 'why-broken' in temrinal url with QR code is generated which consist an AI info why cmd not works based on all info from pevious cmd execs
"""